<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Enums\ApprovalStatus;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Mail\TemplateTestMail;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\HelpArticle;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/Helpers.php';

/**
 * M3.5 through the admin (m3.5-contract §1/§4/§6), lane b: draft → publish (reason) → rollback with versions, audit diffs and a new
 * app-config ETag; refusals as the error `refused` in words; the recent password on every ⚿ write; four-eyes that a direct POST
 * cannot bypass (maintenance on, a critical flag in production, a legal re-consent publish).
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
});

function adm35Etag(): string
{
    app(AppConfig::class)->flush();

    return (string) test()->getJson('/api/v1/app-config')->assertOk()->headers->get('ETag');
}

describe('draft → publish → rollback', function () {
    it('saves a draft, publishes it with a reason, changes the ETag and audits the diff, then rolls back as a new version', function () {
        $editor = adm32SignedIn('content_editor');
        $before = adm35Etag();

        $item = ['title' => ['de' => 'Treffen am Nürburgring', 'en' => null], 'body' => ['de' => 'Am Samstag ab 10 Uhr am Parkplatz Brünnchen.', 'en' => null], 'cta' => null, 'audience' => 'all', 'starts_at' => null, 'ends_at' => null, 'dismissible' => true, 'severity' => 'info'];
        $this->post('/admin/content/announcements/draft', ['payload' => ['items' => [$item]], 'revision' => null])->assertSessionHas('success', 'config.flash.draft_saved');
        $draft = ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Draft)->sole();
        expect($draft->created_by)->toBe($editor->id)->and(adm35Etag())->toBe($before);

        $this->post('/admin/content/announcements/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');
        $live = ConfigVersion::query()->where('key', 'announcements')->where('status', ConfigVersionStatus::Published)->sole();
        $published = AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail();
        $afterPublish = adm35Etag();
        expect($live->reason)->toBe(adm32Reason())
            ->and($published->after['changes'])->not->toBe([])
            ->and($afterPublish)->not->toBe($before)
            ->and($this->getJson('/api/v1/app-config')->json('data.announcements.0.title'))->toBe('Treffen am Nürburgring');

        // A second version, then the rollback to the first: a copy as the newest version, history untouched.
        $second = ['items' => [[...$item, 'id' => $live->payload['items'][0]['id'], 'title' => ['de' => 'Treffen verschoben', 'en' => null]]]];
        $this->post('/admin/content/announcements/draft', ['payload' => $second]);
        $this->post('/admin/content/announcements/publish', ['reason' => adm32Reason(), 'revision' => 1])->assertSessionHas('success');
        $afterSecond = adm35Etag();
        $this->post("/admin/content/versions/announcements/{$live->version}/rollback", ['reason' => adm32Reason()])->assertSessionHas('success', 'config.flash.rolled_back');

        $newest = ConfigVersion::query()->where('key', 'announcements')->orderByDesc('version')->firstOrFail();
        expect($newest->status)->toBe(ConfigVersionStatus::Published)
            ->and($newest->version)->toBeGreaterThan($live->version)
            ->and($newest->reason)->toStartWith("Rollback auf v{$live->version}")
            ->and($newest->payload['items'][0]['title']['de'])->toBe('Treffen am Nürburgring')
            ->and(ConfigVersion::query()->where('key', 'announcements')->where('status', '!=', ConfigVersionStatus::Draft)->count())->toBe(3)
            ->and(AuditEvent::query()->where('action', 'config.rolled_back')->count())->toBe(1)
            // The ETag follows the content: the second version changed it, the rollback brings the first one's back.
            ->and($afterSecond)->not->toBe($afterPublish)
            ->and(adm35Etag())->toBe($afterPublish);
    });

    it('answers someone else\'s draft and a stale revision as the error `refused` in words, never a 500', function () {
        $owner = adm32SignedIn('owner');
        adm35Draft(staffWithRole('content_editor'), ConfigKey::Announcements, ['items' => []]);

        $this->post('/admin/content/announcements/draft', ['payload' => ['items' => []], 'revision' => null])
            ->assertStatus(303)->assertSessionHasErrors('refused');

        ConfigVersion::query()->where('key', 'announcements')->delete();
        adm35Draft($owner, ConfigKey::Announcements, ['items' => []]);
        $this->post('/admin/content/announcements/draft', ['payload' => ['items' => []], 'revision' => 7])->assertSessionHasErrors('refused');
        $this->post('/admin/content/announcements/publish', ['reason' => adm32Reason(), 'revision' => 7])->assertSessionHasErrors('refused');
    });

    it('turns refusals into the German sentence of config.refused', function () {
        $owner = adm32SignedIn('owner');
        adm35Draft(staffWithRole('content_editor'), ConfigKey::Announcements, ['items' => []]);

        $response = $this->post('/admin/content/announcements/draft', ['payload' => ['items' => []], 'revision' => null]);

        $response->assertSessionHasErrors('refused');
        expect(session('errors')->first('refused'))->toStartWith('Hier gibt es schon einen Entwurf')
            ->and(ConfigVersion::query()->where('key', 'announcements')->where('created_by', $owner->id)->exists())->toBeFalse();
    });

    it('shows field errors of the schema under their payload path', function () {
        adm32SignedIn('admin');

        $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['min_version' => ['ios' => '2.0.0']])])
            ->assertSessionHasErrors('min_version.ios');
    });
});

describe('recent password (ADR-215)', function () {
    it('asks for the password before every ⚿ write and changes nothing', function (string $role, string $method, string $uri, array $data, Closure $unchanged) {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.recent_check']);
        $help = HelpArticle::factory()->create(['key' => 'recent-check']);
        $legal = LegalDocument::factory()->create(['key' => 'imprint', 'version' => '77']);
        $staff = adm35StalePassword($role);
        $draft = adm35Draft($staff, ConfigKey::Branding, m35Branding(['accent_set' => 'racingBlue']));
        $uri = strtr($uri, ['{flag}' => (string) $flag->id, '{help}' => (string) $help->id, '{legal}' => (string) $legal->id]);

        $this->call($method, $uri, [...$data, 'revision' => $draft->revision])->assertStatus(303)->assertSessionHas('confirm_password', true);

        expect($unchanged())->toBeTrue();
    })->with([
        'brand publish' => ['content_editor', 'POST', '/admin/brand/publish', ['reason' => 'Neue Saison, neues Akzentblau.'], fn () => ConfigVersion::query()->where('key', 'branding')->where('status', ConfigVersionStatus::Published)->doesntExist()],
        'rollback' => ['content_editor', 'POST', '/admin/content/versions/branding/1/rollback', ['reason' => 'Zurück auf die erste Fassung.'], fn () => ConfigVersion::query()->where('key', 'branding')->count() === 1],
        'flag change' => ['admin', 'PATCH', '/admin/config/flags/{flag}', ['changes' => ['enabled' => true], 'reason' => 'Test der Bestätigung.'], fn () => FeatureFlag::query()->where('key', 'sig.recent_check')->value('enabled') === false],
        'remote draft' => ['admin', 'POST', '/admin/config/remote/draft', ['payload' => m35Remote()], fn () => ConfigVersion::query()->where('key', 'remote_config')->doesntExist()],
        'legal publish' => ['admin', 'POST', '/admin/content/legal/drafts/{legal}/publish', ['reason' => 'Neue Anschrift im Impressum.'], fn () => LegalDocument::query()->where('version', '77')->value('published_at') === null],
        'template test' => ['content_editor', 'POST', '/admin/content/templates/mail.report_received/de/test', [], fn () => Mail::sent(TemplateTestMail::class)->isEmpty() && Mail::queued(TemplateTestMail::class)->isEmpty()],
        'help delete' => ['content_editor', 'DELETE', '/admin/content/help/{help}', ['reason' => 'Doppelter Artikel entfernt.'], fn () => HelpArticle::query()->where('key', 'recent-check')->exists()],
    ]);

    it('saves drafts without asking for the password (nothing goes live)', function () {
        adm35StalePassword('content_editor');

        $this->post('/admin/brand/draft', ['payload' => m35Branding(['accent_set' => 'pitGreen'])])->assertSessionHas('success', 'config.flash.draft_saved');
        expect(ConfigVersion::query()->where('key', 'branding')->where('status', ConfigVersionStatus::Draft)->value('payload')['accent_set'])->toBe('pitGreen');
    });
});

describe('four eyes (ADR-214): a direct POST cannot bypass the approval', function () {
    it('turns publishing maintenance on into a maintenance.enable request; nothing goes live; off is immediate', function () {
        $admin = adm32SignedIn('admin');
        adm35Publish($admin, ConfigKey::RemoteConfig, m35Remote());
        $draft = adm35Draft($admin, ConfigKey::RemoteConfig, m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wir sind gleich wieder da.', 'en' => null]]]));

        $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])
            ->assertStatus(303)->assertSessionHas('approval', fn (array $flash) => $flash['title'] === 'approvals.maintenance_enable.title');

        app(AppConfig::class)->flush();
        expect(ApprovalRequest::query()->where('action', 'maintenance.enable')->where('status', ApprovalStatus::Pending)->count())->toBe(1)
            ->and($this->getJson('/api/v1/app-config')->json('data.maintenance.enabled'))->toBeFalse()
            ->and(ConfigVersion::query()->where('key', 'remote_config')->where('status', ConfigVersionStatus::Published)->sole()->payload['maintenance']['enabled'])->toBeFalse();

        // The page shows the pending request and locks the draft.
        $this->get('/admin/config/remote')->assertInertia(fn ($page) => $page->where('editor.needsApproval', 'maintenance.enable')->where('editor.approval.title', 'approvals.maintenance_enable.title'));
    });

    it('switches maintenance off at once', function () {
        $admin = adm32SignedIn('admin');
        ConfigVersion::query()->create(['key' => 'remote_config', 'version' => 1, 'status' => ConfigVersionStatus::Published, 'revision' => 1, 'payload' => m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wartung bis 12 Uhr.', 'en' => null]]]), 'created_by' => $admin->id, 'published_at' => now()]);
        $draft = adm35Draft($admin, ConfigKey::RemoteConfig, m35Remote());

        $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');
        expect(ApprovalRequest::query()->count())->toBe(0);
    });

    it('turns a change to a critical flag in production into a flags.critical_change request and changes nothing', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.critical_check', 'enabled' => false, 'rules' => ['critical' => true]]);
        adm32SignedIn('admin');
        // In production the CSRF check of a test request is real; this test is about the four-eyes rule.
        $this->withoutMiddleware(PreventRequestForgery::class);
        app()->detectEnvironment(fn () => 'production');

        try {
            $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()])
                ->assertStatus(303)->assertSessionHas('approval', fn (array $flash) => $flash['title'] === 'approvals.flags_critical_change.title');
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }

        expect($flag->refresh()->enabled)->toBeFalse()
            ->and(ApprovalRequest::query()->where('action', 'flags.critical_change')->where('status', ApprovalStatus::Pending)->count())->toBe(1);
    });

    it('changes a critical flag outside production at once, audited with before and after', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'sig.critical_local', 'enabled' => false, 'rules' => ['critical' => true]]);
        adm32SignedIn('admin');

        $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()])->assertSessionHas('success', 'config.flash.flag_changed');

        $event = AuditEvent::query()->where('action', 'flag.changed')->latest('id')->firstOrFail();
        expect($flag->refresh()->enabled)->toBeTrue()->and($event->before['enabled'])->toBeFalse()->and($event->after['enabled'])->toBeTrue();
    });

    it('refuses an ai.* flag without a provider in words', function () {
        $flag = FeatureFlag::factory()->create(['key' => 'ai.translate', 'enabled' => false]);
        adm32SignedIn('admin');

        $this->patch("/admin/config/flags/{$flag->id}", ['changes' => ['enabled' => true], 'reason' => adm32Reason()])
            ->assertSessionHasErrors(['refused' => 'Kein KI-Anbieter konfiguriert']);
        expect($flag->refresh()->enabled)->toBeFalse();
    });

    it('turns a terms publish with re-consent into a legal.publish_reconsent request and publishes nothing', function () {
        $admin = adm32SignedIn('admin');
        $draft = LegalDocument::factory()->create(['key' => 'terms', 'version' => '2', 'requires_reconsent' => true, 'summary' => 'Neue Regeln für QR-Sticker.', 'body_md' => "# AGB\n\nNeue Fassung mit Regeln für QR-Sticker."]);

        $this->post("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])
            ->assertStatus(303)->assertSessionHas('approval', fn (array $flash) => $flash['title'] === 'approvals.legal_publish_reconsent.title');

        expect($draft->refresh()->published_at)->toBeNull()
            ->and(ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->where('status', ApprovalStatus::Pending)->count())->toBe(1)
            ->and($admin->id)->toBeInt();
    });
});
