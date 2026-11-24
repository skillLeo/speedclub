<?php

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Events\SendNearbyEventsDigest;
use App\Services\Insights\EngagementCounters;
use App\Services\Notifications\EngagementPushLimiter;
use Carbon\CarbonImmutable;
use Illuminate\Mail\SendQueuedMailable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/../Events/EventTestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * Review M5.6/M5.7 SF-4: the "Neue Treffen in deiner Nähe" push retries of the later runs in the window are bounded — in id order from a
 * cursor, inside the run's time budget, only for members who could get a push (switch on, a device, the week's engagement pushes left) —
 * and a push the weekly cap drops counts once in ADM-70, not once per retry.
 */
beforeEach(function () {
    evFlags();
    ntfPushOn();
    // Thursday 18:05: the window is open; the members' own quiet hours (from 17:00) hold the push back until the morning.
    $this->travelTo(CarbonImmutable::parse('2026-11-19 18:05', 'Europe/Berlin'));
    evEvent(null, [
        'starts_at' => now()->addDays(5)->setTime(18, 0),
        'ends_at' => now()->addDays(5)->setTime(21, 0),
        'published_at' => now()->subDays(2),
    ]);
});

/**
 * @param  array<string, bool>  $channels
 */
function engNearbyMember(array $channels, bool $device = true): User
{
    $member = User::factory()->create([
        'home_region_label' => 'Hamburg',
        'home_region_lat' => 53.55,
        'home_region_lng' => 9.99,
        'notification_prefs' => ['types' => ['event_nearby' => $channels], 'quiet_hours' => ['enabled' => true, 'from' => '17:00', 'to' => '08:00']],
    ]);

    if ($device) {
        PushToken::factory()->create(['user_id' => $member->id]);
    }

    return $member;
}

function engNearbyRow(User $member): ?Notification
{
    return Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::EventNearby->value)->first();
}

it('retries only members who could get the push, and counts a capped push once', function () {
    Mail::fake();
    $wantsPush = engNearbyMember(['push' => true]);
    $mailOnly = engNearbyMember(['email' => true]);
    $noDevice = engNearbyMember(['push' => true], device: false);
    $capped = engNearbyMember(['push' => true]);

    app(SendNearbyEventsDigest::class)->run();

    foreach ([$wantsPush, $mailOnly, $noDevice, $capped] as $member) {
        expect(engNearbyRow($member)?->pushed_at)->toBeNull();
    }

    foreach ([1, 2, 3] as $slot) {
        DB::table('engagement_push_claims')->insert(['user_id' => $capped->id, 'week' => '2026-11-16', 'slot' => $slot, 'type' => 'spot_alert', 'notification_id' => null, 'created_at' => now()]);
    }

    // Friday morning, every ten minutes: the retries.
    foreach (['08:10', '08:20', '08:30', '08:40'] as $time) {
        $this->travelTo(CarbonImmutable::parse("2026-11-20 $time", 'Europe/Berlin'));
        app(SendNearbyEventsDigest::class)->run();
    }

    expect(engNearbyRow($wantsPush)?->refresh()->pushed_at)->not->toBeNull()
        ->and(engNearbyRow($mailOnly)?->refresh()->pushed_at)->toBeNull()
        ->and(engNearbyRow($noDevice)?->refresh()->pushed_at)->toBeNull()
        ->and(engNearbyRow($capped)?->refresh()->pushed_at)->toBeNull()
        // The capped member is skipped before any claim, so the four mornings add no "dropped" at all.
        ->and(EngagementCounters::lastDays(EngagementCounters::PUSH_DROPPED, 7))->toBe(0)
        ->and(app(EngagementPushLimiter::class)->used($wantsPush))->toBe(1)
        ->and(ntfPushes())->toHaveCount(1);
});

it('tries nothing more once the run\'s time is used, and the next run takes over', function () {
    $member = engNearbyMember(['push' => true]);
    app(SendNearbyEventsDigest::class)->run();

    $this->travelTo(CarbonImmutable::parse('2026-11-20 08:10', 'Europe/Berlin'));
    expect(app(SendNearbyEventsDigest::class)->run(0)['pushed'])->toBe(0)
        ->and(engNearbyRow($member)?->refresh()->pushed_at)->toBeNull();

    $this->travelTo(CarbonImmutable::parse('2026-11-20 08:20', 'Europe/Berlin'));
    expect(app(SendNearbyEventsDigest::class)->run()['pushed'])->toBe(1);
});

it('retries in id order and comes round again after the last row', function () {
    $members = collect(range(1, 3))->map(fn () => engNearbyMember(['push' => true]));
    app(SendNearbyEventsDigest::class)->run();

    // Still inside the members' quiet hours: every row is tried, none pushes, and the cursor starts over at the end.
    $this->travelTo(CarbonImmutable::parse('2026-11-20 07:30', 'Europe/Berlin'));
    expect(app(SendNearbyEventsDigest::class)->run()['pushed'])->toBe(0);

    $this->travelTo(CarbonImmutable::parse('2026-11-20 08:10', 'Europe/Berlin'));
    expect(app(SendNearbyEventsDigest::class)->run()['pushed'])->toBe(3);

    foreach ($members as $member) {
        expect(engNearbyRow($member)?->refresh()->pushed_at)->not->toBeNull();
    }
});

it('asks the e-mail switch again when the queued nearby mail is sent: an unsubscribe in between wins (review M5.6 NH)', function (bool $unsubscribe) {
    Queue::fake();
    $member = engNearbyMember(['email' => true]);

    app(SendNearbyEventsDigest::class)->run();

    $jobs = Queue::pushed(SendQueuedMailable::class);
    expect($jobs)->toHaveCount(1);

    if ($unsubscribe) {
        $this->post(SendNearbyEventsDigest::unsubscribeUrl($member))->assertOk();
    }

    // The array mailer of the tests keeps what was really sent (MailFake would not see a mailable sent by the queued job).
    app()->call([$jobs->first(), 'handle']);
    $sent = app('mail.manager')->mailer('array')->getSymfonyTransport()->messages()
        ->filter(fn ($message): bool => str_contains((string) $message->getEnvelope()->getRecipients()[0]->getAddress(), (string) $member->email));

    expect($sent)->toHaveCount($unsubscribe ? 0 : 1);
})->with(['unsubscribed before the worker' => [true], 'still subscribed' => [false]]);
