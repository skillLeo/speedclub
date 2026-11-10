<?php

use App\Actions\Admin\Config\DiscardConfigDraft;
use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\RollbackConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/ConfigHelpers.php';

/**
 * M3.5 §1: one versioning model. A draft per key, publish with a reason and a JSON diff, rollback as a new version, every publish
 * visible in GET app-config with a new ETag.
 */
beforeEach(function () {
    $this->staff = m31Staff('admin');
    $this->save = fn (array $payload, ?int $revision = null, ConfigKey $key = ConfigKey::RemoteConfig, $staff = null) => app(SaveConfigDraft::class)->handle($staff ?? $this->staff, $key, $payload, $revision);
    $this->publish = fn (int $revision, ConfigKey $key = ConfigKey::RemoteConfig, $staff = null) => app(PublishConfigVersion::class)->handle($staff ?? $this->staff, $key, m35Reason(), $revision);
});

it('publishes a draft: new version, the old one superseded, the diff audited and app-config with a new ETag', function () {
    $first = $this->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.latest_version.ios', '0.1.0');
    $etag = $first->headers->get('ETag');

    $draft = ($this->save)(m35Remote(['latest_version' => ['ios' => '0.2.0', 'android' => '0.2.0']]));
    expect($draft->status)->toBe(ConfigVersionStatus::Draft)->and($draft->revision)->toBe(1);

    // A draft is not live.
    $this->withHeader('If-None-Match', $etag)->getJson('/api/v1/app-config')->assertStatus(304);

    $outcome = ($this->publish)(1);
    expect($outcome->waitsForApproval())->toBeFalse()
        ->and($outcome->version->status)->toBe(ConfigVersionStatus::Published)
        ->and($outcome->version->reason)->toBe(m35Reason());

    $this->withHeader('If-None-Match', $etag)->getJson('/api/v1/app-config')
        ->assertOk()->assertJsonPath('data.latest_version.ios', '0.2.0')->assertJsonPath('data.latest_version.android', '0.2.0');

    $event = AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail();
    expect($event->before['changes'])->toMatchArray(['latest_version.ios' => null])
        ->and($event->after['changes'])->toMatchArray(['latest_version.ios' => '0.2.0', 'latest_version.android' => '0.2.0'])
        ->and($event->after['version'])->toBe($outcome->version->version)
        ->and($event->reason)->toBe(m35Reason());

    // The second publish supersedes the first.
    ($this->save)(m35Remote(['min_version' => ['ios' => '0.2.0']]));
    $second = ($this->publish)(1)->version;

    expect(ConfigVersion::query()->find($outcome->version->id)->status)->toBe(ConfigVersionStatus::Superseded)
        ->and($second->version)->toBeGreaterThan($outcome->version->version)
        ->and(ConfigVersion::query()->where('key', 'remote_config')->where('status', ConfigVersionStatus::Published)->count())->toBe(1);
});

it('keeps one draft per key: another staff member is refused, a stale revision is refused', function () {
    ($this->save)(m35Remote());
    $other = m31Staff('owner');

    expect(fn () => ($this->save)(m35Remote(), null, ConfigKey::RemoteConfig, $other))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('draft_taken')->and($e->status())->toBe(409));
    expect(fn () => ($this->save)(m35Remote(), 7))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('stale_revision'));
    expect(fn () => ($this->save)(m35Remote()))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('stale_revision'));

    $updated = ($this->save)(m35Remote(['latest_version' => ['ios' => '0.3.0']]), 1);
    expect($updated->revision)->toBe(2)->and(ConfigVersion::query()->where('key', 'remote_config')->where('status', 'draft')->count())->toBe(1);

    expect(fn () => ($this->publish)(1))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('stale_revision'));
    expect(fn () => ($this->publish)(2, ConfigKey::RemoteConfig, $other))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('draft_taken'));
});

it('refuses a publish without a reason, without a draft and without a change', function () {
    expect(fn () => app(PublishConfigVersion::class)->handle($this->staff, ConfigKey::RemoteConfig, 'kurz', 1))->toThrow(ValidationException::class);
    expect(fn () => ($this->publish)(1))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('no_draft'));

    ($this->save)(m35Remote());
    ($this->publish)(1);
    ($this->save)(m35Remote());

    expect(fn () => ($this->publish)(1))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('unchanged'));
});

it('validates the payload of the key', function (array $payload, string $field) {
    expect(fn () => ($this->save)($payload))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey($field));
})->with([
    'version format' => [m35Remote(['min_version' => ['ios' => '1.0']]), 'min_version.ios'],
    'min above latest' => [m35Remote(['min_version' => ['ios' => '0.9.0']]), 'min_version.ios'],
    'maintenance without message' => [m35Remote(['maintenance' => ['enabled' => true]]), 'maintenance.message.de'],
]);

it('rolls back by publishing a copy as a new version, history untouched', function () {
    ($this->save)(m35Remote(['latest_version' => ['ios' => '0.2.0']]));
    $v1 = ($this->publish)(1)->version;
    ($this->save)(m35Remote(['latest_version' => ['ios' => '0.3.0']]));
    $v2 = ($this->publish)(1)->version;

    $rollback = app(RollbackConfigVersion::class)->handle($this->staff, ConfigKey::RemoteConfig, $v1->version, 'Version 0.3.0 war zu früh.');

    expect($rollback->version->version)->toBeGreaterThan($v2->version)
        ->and($rollback->version->payload)->toEqual($v1->payload)
        ->and($rollback->version->reason)->toBe('Rollback auf v'.$v1->version.': Version 0.3.0 war zu früh.')
        ->and($v1->fresh()->status)->toBe(ConfigVersionStatus::Superseded)
        ->and($v1->fresh()->payload)->toEqual($v1->payload)
        ->and($v2->fresh()->status)->toBe(ConfigVersionStatus::Superseded);

    $this->getJson('/api/v1/app-config')->assertJsonPath('data.latest_version.ios', '0.2.0');

    $event = AuditEvent::query()->where('action', 'config.rolled_back')->latest('id')->firstOrFail();
    expect($event->after['rolled_back_to'])->toBe($v1->version)->and($event->after['changes'])->toBe(['latest_version.ios' => '0.2.0']);

    expect(fn () => app(RollbackConfigVersion::class)->handle($this->staff, ConfigKey::RemoteConfig, $rollback->version->version, m35Reason()))
        ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('already_live'));
    expect(fn () => app(RollbackConfigVersion::class)->handle($this->staff, ConfigKey::RemoteConfig, 999, m35Reason()))
        ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('version_missing'));
});

it('renumbers a draft that a rollback overtook', function () {
    ($this->save)(m35Remote(['latest_version' => ['ios' => '0.2.0']]));
    $v1 = ($this->publish)(1)->version;
    ($this->save)(m35Remote(['latest_version' => ['ios' => '0.3.0']]));
    ($this->publish)(1);
    $draft = ($this->save)(m35Remote(['latest_version' => ['ios' => '0.4.0']]));
    $rollback = app(RollbackConfigVersion::class)->handle($this->staff, ConfigKey::RemoteConfig, $v1->version, m35Reason())->version;

    $published = ($this->publish)(1)->version;

    expect($published->id)->toBe($draft->id)->and($published->version)->toBeGreaterThan($rollback->version);
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.latest_version.ios', '0.4.0');
});

it('lets the creator discard a draft; someone with the publish atom only with a reason', function () {
    m31Roles();
    $editor = m31Staff('content_editor');
    app(SaveConfigDraft::class)->handle($editor, ConfigKey::Announcements, ['items' => []], null);

    expect(fn () => app(DiscardConfigDraft::class)->handle($this->staff, ConfigKey::Announcements))->toThrow(ValidationException::class);
    app(DiscardConfigDraft::class)->handle($this->staff, ConfigKey::Announcements, 'Verwaister Entwurf aus dem Urlaub.');

    expect(app(ConfigVersions::class)->draft(ConfigKey::Announcements))->toBeNull()
        ->and(AuditEvent::query()->where('action', 'config.draft_discarded')->firstOrFail()->reason)->toBe('Verwaister Entwurf aus dem Urlaub.');

    expect(fn () => app(DiscardConfigDraft::class)->handle($editor, ConfigKey::Announcements))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('no_draft'));
});

it('checks the atoms inside: remote config', function (string $role, bool $allowed) {
    $staff = m31Staff($role);
    $run = fn () => ($this->save)(m35Remote(), null, ConfigKey::RemoteConfig, $staff);

    $allowed ? expect($run())->toBeInstanceOf(ConfigVersion::class) : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('remote_config.manage'));

it('checks the atoms inside: announcements are drafted with content.edit and published with content.publish', function (string $role, bool $allowed) {
    $staff = m31Staff($role);
    $run = function () use ($staff) {
        ($this->save)(['items' => [['title' => ['de' => 'Neu'], 'body' => ['de' => 'Text'], 'audience' => 'all']]], null, ConfigKey::Announcements, $staff);

        return ($this->publish)(1, ConfigKey::Announcements, $staff);
    };

    $allowed ? expect($run()->version)->not->toBeNull() : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('content.edit', 'content.publish'));

it('refuses a suspended staff member', function () {
    $staff = m31Staff('admin');
    $staff->forceFill(['status' => 'suspended'])->save();

    expect(fn () => ($this->save)(m35Remote(), null, ConfigKey::RemoteConfig, $staff->fresh()))->toThrow(AuthorizationException::class);
});

it('keeps the org key to Owners', function () {
    expect(fn () => ($this->save)(['company_name' => 'Speed Club GmbH'], null, ConfigKey::Org))->toThrow(AuthorizationException::class);

    $owner = m31Staff('owner');
    $draft = ($this->save)(['company_name' => 'Speed Club GmbH', 'register_number' => 'HRB 1'], null, ConfigKey::Org, $owner);
    expect($draft->payload['company_name'])->toBe('Speed Club GmbH')->and($draft->payload['register_number'])->toBe('HRB 1');

    // M3.6 narrowed the key to the org fields (OrgIdentity::FIELDS).
    expect(fn () => ($this->save)(['Bad Key' => 1], 1, ConfigKey::Org, $owner))->toThrow(ValidationException::class)
        ->and(fn () => ($this->save)(['legal_name' => 'x'], 1, ConfigKey::Org, $owner))->toThrow(ValidationException::class);
});

it('serves the rate_limits key of M3.4: bounded overrides, written to the cache RateLimits reads', function () {
    $name = array_key_first(RateLimitOverrides::defaults());
    $default = RateLimitOverrides::defaults()[$name]['max'];
    $moderator = m31Staff('moderator');

    expect(fn () => ($this->save)(['overrides' => [$name => $default * 10]], null, ConfigKey::RateLimits, $moderator))->toThrow(ValidationException::class);
    expect(fn () => ($this->save)(['overrides' => ['nope' => 1]], null, ConfigKey::RateLimits, $moderator))->toThrow(ValidationException::class);

    ($this->save)(['overrides' => [$name => $default * 2]], null, ConfigKey::RateLimits, $moderator);
    ($this->publish)(1, ConfigKey::RateLimits, $moderator);

    expect(Cache::get(RateLimitOverrides::CACHE_KEY))->toBe([$name => $default * 2])
        ->and(RateLimitOverrides::published())->toBe([$name => $default * 2]);
});
