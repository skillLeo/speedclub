<?php

use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Enums\NotificationType;
use App\Enums\UserStatus;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\PlanDuePrompts;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\SendPushNotification;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EngagementTestHelpers.php';

/**
 * M5.7 build prompts (10 §6.2, m5.7-contract §4.2): "Ist das KW V3 schon verbaut? Trag es ein." once per plan and target month, at most
 * one per owner in 7 days (row and push), this month or last month only; the switch, the night window and the weekly engagement cap.
 */
beforeEach(function () {
    Queue::fake([SendPushNotification::class]);
    engFlag(true, 'build_prompts');
    config(['speedclub.push.enabled' => true]);
    $this->travelTo(CarbonImmutable::parse('2026-11-16 10:00', 'Europe/Berlin'));
    $this->owner = User::factory()->create(['locale' => 'de']);
    PushToken::factory()->create(['user_id' => $this->owner->id]);
    $this->car = publishedVehicle($this->owner);
});

/**
 * @param  array<string, mixed>  $attributes
 */
function engPlan(Vehicle $car, string $month, array $attributes = []): Modification
{
    return Modification::factory()->planned()->create(['vehicle_id' => $car->id, 'target_month' => $month.'-01', 'title' => 'KW V3', ...$attributes]);
}

function engPrompts(): ?int
{
    return app(PlanDuePrompts::class)->run();
}

/**
 * @return Collection<int, Notification>
 */
function engPlanRows(User $owner)
{
    return Notification::query()->where('notifiable_id', $owner->id)->where('type', NotificationType::PlanDue)->get();
}

it('asks once about a plan whose month arrived, with a push, and never twice', function () {
    $mod = engPlan($this->car, '2026-11');

    expect(engPrompts())->toBe(1)
        ->and(engPrompts())->toBe(0);

    $row = engPlanRows($this->owner)->sole();
    expect($row->data)->toMatchArray(['modification_id' => $mod->id, 'target_month' => '2026-11'])
        ->and($row->vehicle_id)->toBe($this->car->id)
        ->and($row->pushed_at)->not->toBeNull()
        ->and(substr((string) $mod->refresh()->getRawOriginal('plan_prompted_for'), 0, 10))->toBe('2026-11-01');
    Queue::assertPushed(SendPushNotification::class, 1);
});

it('says it in the member\'s words and opens the plans of the car', function () {
    engPlan($this->car, '2026-11');
    engPrompts();
    Sanctum::actingAs($this->owner);

    $item = collect($this->getJson('/api/v1/notifications', ['Accept-Language' => 'de'])->assertOk()->json('data'))
        ->firstWhere('type', 'plan_due');

    expect($item['details'])->toBe(['modification_id' => engPlanRows($this->owner)->sole()->data['modification_id'], 'target_month' => '2026-11']);

    $texts = app(NotificationTexts::class);
    $row = engPlanRows($this->owner)->sole()->load('vehicle');

    expect($texts->push($row, $this->owner)['body'] ?? null)->toBe('Ist das KW V3 schon verbaut? Trag es ein.')
        ->and($texts->path($row))->toBe('/v/'.$this->car->slug.'?section=plans');
});

it('asks about last month\'s plan too, never an older one or a future one', function () {
    engPlan($this->car, '2026-10');
    $old = engPlan($this->car, '2026-09');
    $future = engPlan($this->car, '2026-12');

    engPrompts();

    expect(engPlanRows($this->owner)->pluck('data.target_month')->all())->toBe(['2026-10'])
        ->and($old->refresh()->getRawOriginal('plan_prompted_for'))->toBeNull()
        ->and($future->refresh()->getRawOriginal('plan_prompted_for'))->toBeNull();
});

it('asks at most once a week per owner, the highest priority first, the rest later', function () {
    $normal = engPlan($this->car, '2026-11', ['priority' => ModPriority::Normal]);
    $high = engPlan($this->car, '2026-11', ['priority' => ModPriority::High]);

    engPrompts();
    expect(engPlanRows($this->owner)->sole()->data['modification_id'])->toBe($high->id);

    $this->travel(3)->days();
    engPrompts();
    expect(engPlanRows($this->owner))->toHaveCount(1);

    $this->travel(5)->days();
    engPrompts();
    expect(engPlanRows($this->owner)->pluck('data.modification_id')->sort()->values()->all())->toBe(collect([$high->id, $normal->id])->sort()->values()->all());
});

it('keeps to one prompt a week even when the owner installs the plan right away (review MF-1)', function () {
    $first = engPlan($this->car, '2026-11', ['priority' => ModPriority::High]);
    $second = engPlan($this->car, '2026-11');
    $third = engPlan($this->car, '2026-11', ['priority' => ModPriority::Low]);

    expect(engPrompts())->toBe(1);
    Sanctum::actingAs($this->owner);
    $this->postJson("/api/v1/mods/{$first->id}/install", ['installed_on' => '2026-11'])->assertOk();

    // The row is gone with the install (Notifier::forgetPlanDue); the limit still holds the next days.
    expect(engPlanRows($this->owner))->toHaveCount(0)
        ->and($this->owner->refresh()->plan_prompted_at)->not->toBeNull();

    foreach ([1, 2, 6] as $day) {
        $this->travelTo(CarbonImmutable::parse('2026-11-16 10:00', 'Europe/Berlin')->addDays($day));
        expect(engPrompts())->toBe(0, "day $day");
    }

    $this->travelTo(CarbonImmutable::parse('2026-11-23 10:10', 'Europe/Berlin'));
    expect(engPrompts())->toBe(1)
        ->and(engPlanRows($this->owner)->sole()->data['modification_id'])->toBe($second->id)
        ->and($third->refresh()->getRawOriginal('plan_prompted_for'))->toBeNull();
});

it('asks again once when the plan moves to a later month', function () {
    $mod = engPlan($this->car, '2026-11');
    engPrompts();

    $this->travelTo(CarbonImmutable::parse('2026-12-01 10:00', 'Europe/Berlin'));
    $mod->refresh()->forceFill(['target_month' => '2026-12-01'])->save();

    expect(engPrompts())->toBe(1)
        ->and(engPlanRows($this->owner)->pluck('data.target_month')->sort()->values()->all())->toBe(['2026-11', '2026-12']);
});

it('takes the question back once the plan is installed, deleted or rescheduled', function (Closure $change) {
    $mod = engPlan($this->car, '2026-11');
    engPrompts();
    Sanctum::actingAs($this->owner);

    $change($mod);

    expect(engPlanRows($this->owner))->toHaveCount(0);
})->with([
    'installed' => [fn (Modification $mod) => test()->postJson("/api/v1/mods/{$mod->id}/install", ['installed_on' => '2026-11'])->assertOk()],
    'deleted' => [fn (Modification $mod) => test()->deleteJson("/api/v1/mods/{$mod->id}")->assertNoContent()],
    'rescheduled' => [fn (Modification $mod) => test()->patchJson("/api/v1/mods/{$mod->id}", ['target_month' => '2027-03'])->assertOk()],
]);

it('writes the row without a push when the switch is off, at night, or when the week\'s engagement pushes are used up', function (Closure $setup) {
    $setup($this);
    engPlan($this->car, '2026-11');

    engPrompts();

    expect(engPlanRows($this->owner)->sole()->pushed_at)->toBeNull();
    Queue::assertNotPushed(SendPushNotification::class);
})->with([
    'switch off' => [fn ($test) => $test->owner->forceFill(['notification_prefs' => ['types' => ['plan_due' => ['push' => false]]]])->save()],
    'night (23:00)' => [function ($test): void {
        $test->owner->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => false]]])->save();
        test()->travelTo(CarbonImmutable::parse('2026-11-16 23:00', 'Europe/Berlin'));
    }],
    'three engagement pushes this week' => [function ($test): void {
        foreach ([1, 2, 3] as $slot) {
            DB::table('engagement_push_claims')->insert(['user_id' => $test->owner->id, 'week' => '2026-11-16', 'slot' => $slot, 'type' => 'badge_unlocked', 'notification_id' => null, 'created_at' => now()]);
        }
    }],
]);

it('never asks samples, unverified or suspended owners, about deleted cars, or while the flag is off', function (Closure $setup) {
    $mod = engPlan($this->car, '2026-11');
    $setup($this, $mod);

    engPrompts();

    expect(Notification::query()->where('type', NotificationType::PlanDue)->count())->toBe(0);
})->with([
    'sample owner' => [fn ($test) => $test->owner->forceFill(['is_sample' => true])->save()],
    'sample car' => [fn ($test) => $test->car->forceFill(['is_sample' => true])->save()],
    'unverified owner' => [fn ($test) => $test->owner->forceFill(['email_verified_at' => null])->save()],
    'suspended owner' => [fn ($test) => $test->owner->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => null]]])->save()],
    'deleted car' => [fn ($test) => $test->car->delete()],
    'installed already' => [fn ($test, Modification $mod) => $mod->forceFill(['status' => ModStatus::Installed, 'target_month' => null])->save()],
    'flag off' => [fn () => engFlag(false, 'build_prompts')],
]);

it('is scheduled every ten minutes from 10:00 to 11:55 in Germany', function () {
    expect(engScheduledAt('plans:due-prompts', '2026-11-16 10:00'))->toBeTrue()
        ->and(engScheduledAt('plans:due-prompts', '2026-11-16 11:50'))->toBeTrue()
        ->and(engScheduledAt('plans:due-prompts', '2026-11-16 10:05'))->toBeFalse()
        ->and(engScheduledAt('plans:due-prompts', '2026-11-16 09:50'))->toBeFalse()
        ->and(engScheduledAt('plans:due-prompts', '2026-11-16 15:00'))->toBeFalse();
});
