<?php

use App\Actions\Admin\Memberships\ManageEntitlements;
use App\Actions\Admin\Memberships\SavePlan;
use App\Enums\MembershipEvent;
use App\Enums\UserStatus;
use App\Models\AuditEvent;
use App\Models\Entitlement;
use App\Models\FeatureFlag;
use App\Models\MembershipPlan;
use App\Models\User;
use App\Services\Team\TeamRefused;
use Database\Seeders\FeatureFlagSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

require_once __DIR__.'/../Team/TeamHelpers.php';

function m36Premium(bool $on = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'premium.enabled'], ['enabled' => $on]);
}

function m36Plan(array $input = []): MembershipPlan
{
    return app(SavePlan::class)->handle(m31Staff('admin'), null, [
        'key' => 'club-plus', 'name' => ['de' => 'Club Plus', 'en' => 'Club Plus'],
        'features' => ['de' => ['Mehr Fotos pro Fahrzeug'], 'en' => ['More photos per vehicle']], 'active' => true, ...$input,
    ]);
}

it('seeds premium.enabled off and answers 404 while it is off', function () {
    $this->seed(FeatureFlagSeeder::class);

    expect(FeatureFlag::query()->where('key', 'premium.enabled')->value('enabled'))->toBeFalse()
        ->and(fn () => m36Plan())->toThrow(NotFoundHttpException::class)
        ->and(fn () => app(ManageEntitlements::class)->grant(m31Staff('admin'), User::factory()->create(), MembershipPlan::factory()->create(), m36Reason()))
        ->toThrow(NotFoundHttpException::class);
});

it('lets only holders of memberships.manage manage plans', function (string $role, bool $allowed) {
    m36Premium();
    $run = fn () => app(SavePlan::class)->handle(m31Staff($role), null, ['key' => 'p-'.$role, 'name' => ['de' => 'Plan'], 'features' => ['de' => []], 'active' => false]);

    $allowed ? expect($run()->exists)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('memberships.manage'));

it('validates plans and keeps the key once created', function () {
    m36Premium();
    $plan = m36Plan();

    expect(fn () => m36Plan())->toThrow(ValidationException::class)
        ->and(fn () => m36Plan(['key' => 'Bad Key']))->toThrow(ValidationException::class)
        ->and(fn () => app(SavePlan::class)->handle(m31Staff('admin'), $plan, ['key' => 'other', 'name' => ['de' => 'X'], 'features' => ['de' => []], 'active' => true]))->toThrow(ValidationException::class);

    app(SavePlan::class)->handle(m31Staff('admin'), $plan, ['name' => ['de' => 'Club Plus 2026'], 'features' => ['de' => ['A', 'B']], 'active' => false]);
    expect($plan->fresh()->name['de'])->toBe('Club Plus 2026')->and($plan->fresh()->active)->toBeFalse()
        ->and(AuditEvent::query()->where('action', MembershipEvent::PlanUpdated->value)->exists())->toBeTrue();
});

it('grants with reason and end date and revokes once, audited', function () {
    m36Premium();
    $plan = m36Plan();
    $member = User::factory()->create();
    $admin = m31Staff('admin');

    expect(fn () => app(ManageEntitlements::class)->grant($admin, $member, $plan, 'kurz'))->toThrow(ValidationException::class)
        ->and(fn () => app(ManageEntitlements::class)->grant($admin, $member, $plan, m36Reason(), now()->addDay(), now()))->toThrow(TeamRefused::class);

    $entitlement = app(ManageEntitlements::class)->grant($admin, $member, $plan, m36Reason(), null, now()->addMonth());
    expect(Entitlement::query()->current()->count())->toBe(1);

    app(ManageEntitlements::class)->revoke($admin, $entitlement, 'Beta-Test beendet, Zugang zurückgenommen.');
    expect($entitlement->fresh()->revoked_at)->not->toBeNull()
        ->and(Entitlement::query()->current()->count())->toBe(0)
        ->and(fn () => app(ManageEntitlements::class)->revoke($admin, $entitlement->fresh(), m36Reason()))->toThrow(TeamRefused::class)
        ->and(AuditEvent::query()->whereIn('action', [MembershipEvent::EntitlementGranted->value, MembershipEvent::EntitlementRevoked->value])->count())->toBe(2);
});

it('refuses an inactive plan and a closed account', function () {
    m36Premium();
    $plan = m36Plan(['active' => false]);

    expect(fn () => app(ManageEntitlements::class)->grant(m31Staff('admin'), User::factory()->create(), $plan, m36Reason()))->toThrow(TeamRefused::class)
        ->and(fn () => app(ManageEntitlements::class)->grant(m31Staff('admin'), User::factory()->create(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()]), MembershipPlan::factory()->create(), m36Reason()))
        ->toThrow(TeamRefused::class);
});
