<?php

use App\Models\User;
use App\Models\ViewDay;
use App\Models\ViewEvent;
use App\Models\ViewSalt;
use App\Models\WeeklyRecap;
use App\Services\Insights\ViewRetention;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/EngagementTestHelpers.php';

/**
 * M5.7 views:prune (m5.7-contract §7): raw events after 90 days in batches within the time budget, the daily totals untouched; past
 * salts; recaps after 12 weeks; engagement push claims after 14 days. Deletes only, safe to run again.
 */
beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-18 04:15', 'Europe/Berlin'));
});

it('deletes raw events after 90 days and leaves the daily totals alone', function () {
    $owner = User::factory()->create();
    // SF-2: events have only their Berlin day.
    ViewEvent::factory()->count(3)->create(['owner_id' => $owner->id, 'day' => '2026-08-18']);
    $kept = ViewEvent::factory()->create(['owner_id' => $owner->id, 'day' => '2026-08-20']);
    ViewDay::factory()->forProfile($owner)->create(['day' => now()->subDays(91)->toDateString(), 'views' => 3]);
    config(['speedclub.insights.prune_batch' => 2]);

    $this->artisan('views:prune')->expectsOutputToContain('Removed 3 view events')->assertSuccessful();

    expect(ViewEvent::query()->pluck('id')->all())->toBe([$kept->id])
        ->and((int) ViewDay::query()->sum('views'))->toBe(3);

    $this->artisan('views:prune')->expectsOutputToContain('Removed 0 view events')->assertSuccessful();
});

it('stops when its time is used and continues on the next run', function () {
    ViewEvent::factory()->create(['day' => '2026-08-01']);
    config(['speedclub.insights.seconds' => 0]);

    expect(app(ViewRetention::class)->prune())->toMatchArray(['view_events' => 0, 'done' => false])
        ->and(ViewEvent::query()->count())->toBe(1);

    config(['speedclub.insights.seconds' => 40]);

    expect(app(ViewRetention::class)->prune())->toMatchArray(['view_events' => 1, 'done' => true]);
});

it('deletes the salts of past days, so their hashes are anonymous', function () {
    ViewSalt::factory()->create(['day' => '2026-11-16']);
    ViewSalt::factory()->create(['day' => '2026-11-17']);
    ViewSalt::factory()->create(['day' => '2026-11-18']);

    app(ViewRetention::class)->prune();

    expect(ViewSalt::query()->pluck('day')->map(fn ($day): string => substr((string) $day, 0, 10))->all())->toBe(['2026-11-18']);
});

it('deletes recaps after 12 weeks and push claims after 14 days', function () {
    $member = User::factory()->create();
    WeeklyRecap::factory()->create(['user_id' => $member->id, 'week' => '2026-08-17']);
    $recent = WeeklyRecap::factory()->create(['user_id' => $member->id, 'week' => '2026-08-24']);
    DB::table('engagement_push_claims')->insert([
        ['user_id' => $member->id, 'week' => '2026-10-26', 'slot' => 1, 'type' => 'plan_due', 'notification_id' => null, 'created_at' => now()],
        ['user_id' => $member->id, 'week' => '2026-11-02', 'slot' => 1, 'type' => 'plan_due', 'notification_id' => null, 'created_at' => now()],
    ]);

    $pruned = app(ViewRetention::class)->prune();

    expect($pruned['weekly_recaps'])->toBe(1)
        ->and(WeeklyRecap::query()->pluck('id')->all())->toBe([$recent->id])
        ->and($pruned['engagement_push_claims'])->toBe(1)
        ->and(DB::table('engagement_push_claims')->pluck('week')->map(fn ($week): string => substr((string) $week, 0, 10))->all())->toBe(['2026-11-02']);
});

it('deletes the ADM-70 day counters after 400 days', function () {
    DB::table('engagement_daily')->insert([
        ['day' => '2025-10-13', 'metric' => 'push_dropped', 'count' => 4],
        ['day' => '2025-10-14', 'metric' => 'push_dropped', 'count' => 2],
    ]);

    expect(app(ViewRetention::class)->prune()['engagement_daily'])->toBe(1)
        ->and(DB::table('engagement_daily')->pluck('day')->map(fn ($day): string => substr((string) $day, 0, 10))->all())->toBe(['2025-10-14']);
});

it('deletes the past salts right after midnight with --salts, nothing else', function () {
    ViewSalt::factory()->create(['day' => '2026-11-17']);
    ViewSalt::factory()->create(['day' => '2026-11-18']);
    ViewEvent::factory()->create(['day' => '2026-01-01']);

    $this->artisan('views:prune', ['--salts' => true])->expectsOutputToContain('Removed 1 salts.')->assertSuccessful();

    expect(ViewSalt::query()->count())->toBe(1)->and(ViewEvent::query()->count())->toBe(1)
        ->and(engScheduledAt('views:prune --salts', '2026-11-19 00:05'))->toBeTrue()
        ->and(engScheduledAt('views:prune --salts', '2026-11-19 04:15'))->toBeFalse();
});

it('is scheduled daily at 04:15 in Germany', function () {
    $event = collect(app(Schedule::class)->events())
        ->first(fn ($event): bool => str_contains((string) $event->command, 'views:prune'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('15 4 * * *')
        ->and($event->timezone)->toBe('Europe/Berlin');
});
