<?php

use App\Enums\NotificationType;
use App\Models\Badge;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Insights\EngagementCounters;
use App\Services\Notifications\EngagementPushLimiter;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\SendPushNotification;
use App\Services\Notifications\SocialPushLimiter;
use Carbon\CarbonImmutable;
use Database\Seeders\BadgeSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/EngagementTestHelpers.php';

/**
 * M5.7 (10 §6 "max 3 engagement pushes/week per user", 10 §16, m5.7-contract §8.3): the system's own prompts and summaries push at most
 * three times per member and ISO week (Europe/Berlin); the rows always stay in the list; a person's acts (follows, messages, forum replies)
 * are never capped by it; the daily social limit and the night window still apply.
 */
beforeEach(function () {
    Queue::fake([SendPushNotification::class]);
    config(['speedclub.push.enabled' => true]);
    // A Monday noon; the member's own quiet hours off, so only the rules under test decide.
    $this->travelTo(CarbonImmutable::parse('2026-11-16 12:00', 'Europe/Berlin'));
    $this->member = User::factory()->create(['notification_prefs' => ['quiet_hours' => ['enabled' => false]]]);
    PushToken::factory()->create(['user_id' => $this->member->id]);
});

function engRecapRow(User $member, string $week): ?Notification
{
    return app(Notifier::class)->weeklyRecap($member, $week, ['views' => 3, 'sticker_scans' => 0, 'new_followers' => 0, 'spots' => 0, 'events_nearby' => 0, 'maintenance_due' => 0]);
}

it('covers the system\'s prompts and summaries, never a person\'s act', function () {
    foreach (['plan_due', 'weekly_recap', 'badge_unlocked', 'car_of_the_day', 'spot_alert', 'qr_milestone', 'build_saved', 'event_nearby'] as $type) {
        expect(EngagementPushLimiter::governs(NotificationType::from($type)))->toBeTrue($type);
    }

    foreach (['new_follower', 'reaction', 'mention', 'comment', 'forum_reply', 'event_reminder', 'maintenance_due', 'security', 'moderation_decision', 'car_of_the_day_owner', 'invite_accepted'] as $type) {
        expect(EngagementPushLimiter::governs(NotificationType::from($type)))->toBeFalse($type);
    }

    // D-6 (m5.7-contract §8.3), event_nearby added with the lead's approval: M5.6's weekly nearby meets are a push the system starts itself.
    expect(EngagementPushLimiter::TYPES)->toBe(['plan_due', 'weekly_recap', 'badge_unlocked', 'car_of_the_day', 'spot_alert', 'qr_milestone', 'build_saved', 'event_nearby']);

    expect(SocialPushLimiter::keepsNightQuiet(NotificationType::PlanDue))->toBeTrue()
        ->and(SocialPushLimiter::keepsNightQuiet(NotificationType::WeeklyRecap))->toBeTrue()
        ->and(SocialPushLimiter::governs(NotificationType::PlanDue))->toBeFalse();
});

it('pushes three engagement rows a week, keeps the fourth in the list without a push, and starts again next Monday', function () {
    // Four different weeks' recaps as four rows of one week (the cap counts pushes, not weeks of content).
    $rows = [];

    foreach (['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'] as $i => $week) {
        $this->travelTo(CarbonImmutable::parse('2026-11-16 12:00', 'Europe/Berlin')->addHours($i));
        $rows[] = engRecapRow($this->member, $week);
    }

    expect(array_map(fn (?Notification $row): bool => $row?->refresh()->pushed_at !== null, $rows))->toBe([true, true, true, false])
        ->and(app(EngagementPushLimiter::class)->used($this->member))->toBe(3)
        ->and(Notification::query()->where('type', NotificationType::WeeklyRecap)->count())->toBe(4);
    Queue::assertPushed(SendPushNotification::class, 3);

    $this->travelTo(CarbonImmutable::parse('2026-11-23 12:00', 'Europe/Berlin'));
    expect(engRecapRow($this->member, '2026-11-23')?->refresh()->pushed_at)->not->toBeNull();
});

it('shares the cap with the M5.9d badge push, and the daily social limit still holds', function () {
    $this->seed(BadgeSeeder::class);
    $this->member->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => false], 'types' => ['badge_unlocked' => ['push' => true]]]])->save();

    $badge = app(Notifier::class)->badgeUnlocked($this->member, Badge::query()->findOrFail('erster-build'));
    $second = app(Notifier::class)->badgeUnlocked($this->member, Badge::query()->findOrFail('volle-garage'));

    expect($badge?->refresh()->pushed_at)->not->toBeNull()
        // The second badge the same day: the social limit says no, and the engagement slot is not used for it.
        ->and($second?->refresh()->pushed_at)->toBeNull()
        ->and(app(EngagementPushLimiter::class)->used($this->member))->toBe(1);
});

it('never counts a person\'s act against the cap', function () {
    foreach ([1, 2, 3] as $slot) {
        DB::table('engagement_push_claims')->insert(['user_id' => $this->member->id, 'week' => '2026-11-16', 'slot' => $slot, 'type' => 'spot_alert', 'notification_id' => null, 'created_at' => now()]);
    }

    $row = app(Notifier::class)->newFollower($this->member, User::factory()->create());

    expect($row?->refresh()->pushed_at)->not->toBeNull();
});

it('gives back exactly the slot it took, never an earlier push\'s slot of the same row (review SF-3)', function () {
    $limiter = app(EngagementPushLimiter::class);
    $row = engRecapRow($this->member, '2026-11-16');
    expect($limiter->used($this->member))->toBe(1);

    $slot = $limiter->claimSlot($this->member, $row);
    expect($slot)->toBe(2);

    $limiter->releaseSlot($this->member, (int) $slot);

    expect($limiter->used($this->member))->toBe(1);
});

it('keeps the earlier push\'s slot when a grouped row comes back inside its cooldown (review SF-3)', function () {
    $limiter = app(EngagementPushLimiter::class);
    $payload = ['views' => 3, 'sticker_scans' => 0, 'new_followers' => 0, 'spots' => 0, 'events_nearby' => 0, 'maintenance_due' => 0];

    $row = app(Notifier::class)->weeklyRecap($this->member, '2026-11-16', $payload);
    expect($row?->refresh()->pushed_at)->not->toBeNull();

    // Five minutes later the same row changes: maybePush claims slot 2, loses the pushed_at claim to the 15-minute cooldown and gives back
    // slot 2 only. Before the fix both slots went, and three more pushes got through.
    $this->travel(5)->minutes();
    app(Notifier::class)->weeklyRecap($this->member, '2026-11-16', [...$payload, 'views' => 4]);

    expect($limiter->used($this->member))->toBe(1);

    foreach (['2026-10-26', '2026-11-02', '2026-11-09'] as $i => $week) {
        $this->travel(20)->minutes();
        engRecapRow($this->member, $week);
    }

    expect($limiter->used($this->member))->toBe(3);
    Queue::assertPushed(SendPushNotification::class, 3);
});

it('counts a dropped push once per row, however often it is tried again (review SF-4)', function () {
    foreach ([1, 2, 3] as $slot) {
        DB::table('engagement_push_claims')->insert(['user_id' => $this->member->id, 'week' => '2026-11-16', 'slot' => $slot, 'type' => 'spot_alert', 'notification_id' => null, 'created_at' => now()]);
    }

    $row = engRecapRow($this->member, '2026-11-16');

    foreach (range(1, 5) as $try) {
        app(Notifier::class)->pushIfDue($row->refresh(), $this->member);
    }

    expect(EngagementCounters::lastDays(EngagementCounters::PUSH_DROPPED, 7))->toBe(1)
        ->and(app(EngagementPushLimiter::class)->exhausted($this->member))->toBeTrue();
});

it('never takes more than three slots, even when the config asks for more', function () {
    config(['speedclub.notifications.engagement_weekly_max' => 10]);
    $limiter = app(EngagementPushLimiter::class);
    $row = new Notification;
    $row->forceFill(['id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'type' => NotificationType::PlanDue]);

    expect(array_map(fn (): bool => $limiter->claim($this->member, $row), range(1, 5)))->toBe([true, true, true, false, false]);
});
