<?php

use App\Actions\Admin\Config\IssuePreviewToken;
use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Services\AppConfig\AppConfig;
use App\Services\Config\ConfigVersions;
use App\Services\Home\HomeCuration;
use Illuminate\Auth\Access\AuthorizationException;

require_once __DIR__.'/../Admin/Config/ConfigHelpers.php';

/**
 * ADM-34: a signed preview token (15 min, staff-bound, read-only) overlays the issuing staff member's drafts in GET app-config and the
 * Home curation for that request only; it never shows another staff member's draft and never publishes.
 */
beforeEach(function () {
    $this->editor = m31Staff('content_editor');
    app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['accent_set' => 'pitGreen', 'default_theme' => 'light']), null);
    $this->token = app(IssuePreviewToken::class)->handle($this->editor);
});

it('shows the own draft for the request carrying the token, uncached, and the live config otherwise', function () {
    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertOk()
        ->assertHeader('X-Robots-Tag', 'noindex')
        ->assertJsonPath('data.branding.accent_set', 'pitGreen')
        ->assertJsonPath('data.branding.default_theme', 'light');

    $this->getJson('/api/v1/app-config', ['X-Preview-Token' => $this->token['token']])->assertJsonPath('data.branding.accent_set', 'pitGreen');
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.branding.accent_set', 'default')->assertHeaderMissing('X-SpeedClub-Preview');

    expect($this->token['keys'])->toBe(['branding'])
        ->and(AuditEvent::query()->where('action', 'config.preview_issued')->firstOrFail()->after['keys'])->toBe(['branding'])
        ->and(json_encode(AuditEvent::query()->get()->toArray()))->not->toContain($this->token['token']);
});

it('never shows another staff member\'s draft', function () {
    $other = m31Staff('admin');
    app(SaveConfigDraft::class)->handle($other, ConfigKey::RemoteConfig, m35Remote(['latest_version' => ['ios' => '9.0.0']]), null);
    $otherToken = app(IssuePreviewToken::class)->handle($other)['token'];

    // The editor's token does not name the admin's remote_config draft …
    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertJsonPath('data.latest_version.ios', '0.1.0');
    // … and the admin's token does not name the editor's branding draft.
    $this->getJson('/api/v1/app-config?preview='.$otherToken)
        ->assertJsonPath('data.branding.accent_set', 'default')
        ->assertJsonPath('data.latest_version.ios', '9.0.0');
});

it('ignores a tampered, expired or foreign-signed token and a token whose staff lost access', function () {
    [$body, $signature] = explode('.', $this->token['token']);
    $tampered = rtrim(strtr(base64_encode(str_replace('"s":'.$this->editor->id, '"s":999', (string) base64_decode(strtr($body, '-_', '+/')))), '+/', '-_'), '=').'.'.$signature;

    $this->getJson('/api/v1/app-config?preview='.$tampered)->assertJsonPath('data.branding.accent_set', 'default');
    $this->getJson('/api/v1/app-config?preview=garbage')->assertJsonPath('data.branding.accent_set', 'default');

    $this->travel(16)->minutes();
    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertJsonPath('data.branding.accent_set', 'default');
    $this->travelBack();

    $this->editor->forceFill(['status' => 'suspended'])->save();
    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertJsonPath('data.branding.accent_set', 'default');
});

it('is read-only: it never publishes and is ignored on writes', function () {
    $before = ConfigVersion::query()->orderBy('id')->get(['id', 'status', 'version'])->toArray();

    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertOk();
    $this->postJson('/api/v1/auth/login?preview='.$this->token['token'], [])->assertStatus(422);

    expect(ConfigVersion::query()->orderBy('id')->get(['id', 'status', 'version'])->toArray())->toBe($before)
        ->and(app(ConfigVersions::class)->live(ConfigKey::Branding))->toBeNull();
});

it('bypasses maintenance for staff unless the maintenance draft itself is previewed', function () {
    $admin = m31Staff('admin');
    ConfigVersion::factory()->create(['key' => 'remote_config', 'version' => 1, 'status' => 'published', 'payload' => m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wartung']]])]);
    app(AppConfig::class)->flush();

    $this->getJson('/api/v1/app-config')->assertJsonPath('data.maintenance.enabled', true);
    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertJsonPath('data.maintenance.enabled', false);

    app(SaveConfigDraft::class)->handle($admin, ConfigKey::RemoteConfig, m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Neue Wartung']]]), null);
    $this->getJson('/api/v1/app-config?preview='.app(IssuePreviewToken::class)->handle($admin)['token'])
        ->assertJsonPath('data.maintenance.enabled', true)->assertJsonPath('data.maintenance.message', 'Neue Wartung');
});

it('previews the Home curation draft', function () {
    $vehicle = m35Vehicle();
    app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::HomeCuration, ['featured' => [['vehicle_id' => $vehicle->id]], 'collections' => []], null);
    $token = app(IssuePreviewToken::class)->handle($this->editor)['token'];

    expect(app(HomeCuration::class)->featuredSlugs())->toBe([]);

    $this->app['request']->query->set('preview', $token);
    $this->app['request']->attributes->remove('speedclub.preview');
    expect(app(HomeCuration::class)->featuredSlugs())->toBe([$vehicle->slug]);
});

it('needs content.view to issue a token', function () {
    expect(fn () => app(IssuePreviewToken::class)->handle(m35StaffWith('flags.manage')))->toThrow(AuthorizationException::class);
});

it('shows the published config again once the draft is published', function () {
    app(PublishConfigVersion::class)->handle($this->editor, ConfigKey::Branding, m35Reason(), 1);

    $this->getJson('/api/v1/app-config?preview='.$this->token['token'])->assertJsonPath('data.branding.accent_set', 'pitGreen');
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.branding.accent_set', 'pitGreen');
});
