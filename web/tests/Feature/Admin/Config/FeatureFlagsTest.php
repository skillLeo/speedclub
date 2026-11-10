<?php

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Enums\ApprovalStatus;
use App\Models\AuditEvent;
use App\Models\FeatureFlag;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/ConfigHelpers.php';

/**
 * ADM-36: flags per environment, staff-only, percentage with a stable member hash, critical → four-eyes in production, ai.* refused
 * without a provider; every change audited and visible in app-config.
 */
beforeEach(function () {
    $this->admin = m31Staff('admin');
    $this->flag = FeatureFlag::factory()->create(['key' => 'sig.legal_status', 'enabled' => false, 'rules' => null, 'description' => 'Legalstatus von Mods']);
});

afterEach(function () {
    app()['env'] = 'testing';
});

it('changes a flag, audits before and after, and app-config follows with a new ETag', function () {
    $etag = $this->getJson('/api/v1/app-config')->assertJsonPath('data.flags', ['sig.legal_status' => false])->headers->get('ETag');

    $outcome = app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['enabled' => true, 'environments' => ['production' => false]], m35Reason());

    expect($outcome->waitsForApproval())->toBeFalse()->and($outcome->flag->enabled)->toBeTrue()
        ->and($outcome->flag->rules['environments'])->toBe(['local' => true, 'staging' => false, 'production' => false]);
    $this->withHeader('If-None-Match', $etag)->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.flags', ['sig.legal_status' => true]);

    $event = AuditEvent::query()->where('action', 'flag.changed')->firstOrFail();
    expect($event->before['enabled'])->toBeFalse()->and($event->after['enabled'])->toBeTrue()->and($event->reason)->toBe(m35Reason());
});

it('validates the change', function (array $changes) {
    expect(fn () => app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, $changes, m35Reason()))->toThrow(ValidationException::class);
})->with([
    'nothing' => [[]],
    'percentage above 100' => [['percentage' => 101]],
    'unknown environment' => [['environments' => ['moon' => true]]],
]);

it('rolls a member flag out to a stable share of members', function () {
    app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['enabled' => true, 'percentage' => 30], m35Reason());
    $members = User::factory()->count(60)->create();
    $flags = app(FeatureFlags::class);

    $on = $members->filter(fn (User $member) => $flags->forMember('sig.legal_status', $member));
    $again = $members->filter(fn (User $member) => $flags->forMember('sig.legal_status', $member));

    expect($on->modelKeys())->toBe($again->modelKeys())
        ->and($on->count())->toBeGreaterThan(5)->toBeLessThan(35);
    $on->each(fn (User $member) => expect(FeatureFlags::bucket('sig.legal_status', $member->id))->toBeLessThan(30));

    // The public answer treats a partial rollout as off; staff-only is never on for members.
    expect($this->getJson('/api/v1/app-config')->json('data.flags')['sig.legal_status'])->toBeFalse();
    app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag->fresh(), ['percentage' => 100, 'staff_only' => true], m35Reason());
    expect($flags->forMember('sig.legal_status', $members->first()))->toBeFalse();
});

it('refuses to switch an ai.* flag on without a provider', function () {
    $ai = FeatureFlag::factory()->create(['key' => 'ai.triage', 'enabled' => false]);
    config(['speedclub.services.ai_provider' => null]);

    expect(fn () => app(UpdateFeatureFlag::class)->handle($this->admin, $ai, ['enabled' => true], m35Reason()))
        ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('ai_provider_missing'));

    // M3.7: a provider name without its key is not a provider (AiGateway::available()).
    config(['speedclub.services.ai_provider' => 'anthropic', 'ai.providers.anthropic.key' => null]);
    expect(fn () => app(UpdateFeatureFlag::class)->handle($this->admin, $ai, ['enabled' => true], m35Reason()))
        ->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('ai_provider_missing'));

    config(['ai.providers.anthropic.key' => 'test-key']);
    expect(app(UpdateFeatureFlag::class)->handle($this->admin, $ai, ['enabled' => true], m35Reason())->flag->enabled)->toBeTrue();
});

it('makes a critical flag change four-eyes in production', function () {
    app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['critical' => true], m35Reason());
    app()['env'] = 'production';

    $outcome = app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag->fresh(), ['enabled' => true], m35Reason());

    expect($outcome->waitsForApproval())->toBeTrue()->and($outcome->approval->action)->toBe('flags.critical_change')
        ->and($this->flag->fresh()->enabled)->toBeFalse();

    expect(m35Approve($outcome->approval)->status)->toBe(ApprovalStatus::Executed)
        ->and($this->flag->fresh()->enabled)->toBeTrue();
    expect(AuditEvent::query()->where('action', 'flag.changed')->latest('id')->firstOrFail()->after['approved_by'])->not->toBeNull();
});

it('treats marking a flag critical in production as critical too, and leaves other flags immediate', function () {
    app()['env'] = 'production';

    expect(app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['critical' => true], m35Reason())->waitsForApproval())->toBeTrue();
    expect(app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['description' => 'Neu'], m35Reason())->waitsForApproval())->toBeFalse();
});

it('fails the approval when the flag changed since the request', function () {
    app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag, ['critical' => true], m35Reason());
    app()['env'] = 'production';
    $approval = app(UpdateFeatureFlag::class)->handle($this->admin, $this->flag->fresh(), ['enabled' => true], m35Reason())->approval;
    $this->travel(2)->seconds();
    $this->flag->fresh()->forceFill(['description' => 'geändert'])->save();

    expect(m35Approve($approval)->status)->toBe(ApprovalStatus::Failed)->and($this->flag->fresh()->enabled)->toBeFalse();
});

it('refuses the executor outside its approval', function () {
    expect(fn () => app(UpdateFeatureFlag::class)->execute($this->admin, m31Staff('owner'), $this->flag, ['enabled' => true], m35Reason()))
        ->toThrow(AuthorizationException::class);
});

it('checks flags.manage inside', function (string $role, bool $allowed) {
    $run = fn () => app(UpdateFeatureFlag::class)->handle(m31Staff($role), $this->flag, ['enabled' => true], m35Reason());

    $allowed ? expect($run()->flag)->not->toBeNull() : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('flags.manage'));
