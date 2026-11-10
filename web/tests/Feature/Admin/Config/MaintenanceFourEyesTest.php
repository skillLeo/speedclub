<?php

use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\RollbackConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ApprovalStatus;
use App\Enums\ConfigKey;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Services\Config\ConfigRefused;
use App\Services\Config\ConfigVersions;
use Illuminate\Auth\Access\AuthorizationException;

require_once __DIR__.'/ConfigHelpers.php';

/**
 * ADM-37, 06 §2: maintenance on is four-eyes (`maintenance.enable`), off is immediate; the executor runs only inside its approval.
 */
beforeEach(function () {
    $this->admin = m31Staff('admin');
    $this->on = m35Remote(['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wir warten die Server bis 22 Uhr.', 'en' => 'Server maintenance until 10 pm.']]]);
});

it('asks for an approval instead of turning maintenance on, and turns it on when another staff member approves', function () {
    $draft = app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, $this->on, null);

    $outcome = app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1);

    expect($outcome->waitsForApproval())->toBeTrue()
        ->and($outcome->approval->action)->toBe('maintenance.enable')
        ->and($outcome->approval->payload)->toBe(['key' => 'remote_config', 'mode' => 'publish', 'draft_id' => $draft->id, 'revision' => 1])
        ->and(app(ConfigVersions::class)->live(ConfigKey::RemoteConfig))->toBeNull();
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.maintenance.enabled', false);

    // Requester ≠ approver.
    expect(fn () => m35Approve($outcome->approval, $this->admin))->toThrow(AuthorizationException::class);

    $approved = m35Approve($outcome->approval);
    expect($approved->status)->toBe(ApprovalStatus::Executed);

    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/app-config')
        ->assertJsonPath('data.maintenance.enabled', true)
        ->assertJsonPath('data.maintenance.message', 'Server maintenance until 10 pm.');

    $event = AuditEvent::query()->where('action', 'config.published')->latest('id')->firstOrFail();
    expect($event->after['requested_by'])->toBe($this->admin->id)->and($event->after['approved_by'])->not->toBe($this->admin->id);
});

it('turns maintenance off at once', function () {
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, $this->on, null);
    m35Approve(app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1)->approval);

    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Remote(), null);
    $outcome = app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1);

    expect($outcome->waitsForApproval())->toBeFalse();
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.maintenance.enabled', false);
});

it('fails the approval when the draft changed after the request', function () {
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, $this->on, null);
    $approval = app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1)->approval;
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Remote(), 1);

    expect(m35Approve($approval)->status)->toBe(ApprovalStatus::Failed)
        ->and(app(ConfigVersions::class)->live(ConfigKey::RemoteConfig))->toBeNull();
});

it('needs maintenance.toggle to ask, and remote_config.manage too', function () {
    $without = m35StaffWith('remote_config.manage', 'content.view');
    app(SaveConfigDraft::class)->handle($without, ConfigKey::RemoteConfig, $this->on, null);

    expect(fn () => app(PublishConfigVersion::class)->handle($without, ConfigKey::RemoteConfig, m35Reason(), 1))->toThrow(AuthorizationException::class);
});

it('treats a rollback to a maintenance version as four-eyes too', function () {
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, $this->on, null);
    m35Approve(app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1)->approval);
    $on = app(ConfigVersions::class)->live(ConfigKey::RemoteConfig);
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Remote(), null);
    app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1);

    $outcome = app(RollbackConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, $on->version, m35Reason());

    expect($outcome->waitsForApproval())->toBeTrue()->and($outcome->approval->payload['mode'])->toBe('rollback');
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.maintenance.enabled', false);

    m35Approve($outcome->approval);
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.maintenance.enabled', true);
});

it('refuses the executors outside the approval', function () {
    app(SaveConfigDraft::class)->handle($this->admin, ConfigKey::RemoteConfig, $this->on, null);
    $approval = app(PublishConfigVersion::class)->handle($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1)->approval;
    $owner = m31Staff('owner');

    expect(fn () => app(ConfigVersions::class)->publishApproved($approval, $this->admin, $owner))->toThrow(AuthorizationException::class);
    // The plain publish refuses a change that needs the approval.
    expect(fn () => app(ConfigVersions::class)->publish($this->admin, ConfigKey::RemoteConfig, m35Reason(), 1))
        ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('approval_required'));
    expect(ApprovalRequest::query()->find($approval->id)->status)->toBe(ApprovalStatus::Pending);
});
