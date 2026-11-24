<?php

use App\Enums\NotificationType;
use App\Models\Badge;
use App\Models\Notification;
use App\Services\Notifications\NotificationFeed;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\SocialPushLimiter;
use Carbon\CarbonImmutable;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M5.9d notification types (m5.9d contract §7, §10.6): the SET-09 switches and their defaults, the category labels, one social push a
 * day across the gift types, the fixed quiet hours 22–08, the HOME-02 rows with their details and the push texts.
 */
function giftNtfAt(string $time): void
{
    test()->travelTo(CarbonImmutable::parse("2026-07-15 $time", 'Europe/Berlin'));
}

beforeEach(fn () => giftBadges());

it('lists the gift types with their own switches and defaults, and their category labels in DE and EN', function () {
    $types = NotificationPrefs::defaults()['types'];

    expect($types['badge_unlocked'])->toBe(['push' => false, 'web_push' => false])
        ->and($types['car_of_the_day'])->toBe(['push' => false, 'web_push' => false])
        ->and($types['car_of_the_day_owner'])->toBe(['push' => true, 'web_push' => true])
        ->and($types['invite_accepted'])->toBe(['push' => true, 'web_push' => true])
        ->and($types['spot_alert'])->toBe(['push' => true, 'web_push' => true]);

    foreach (NotificationPrefs::GIFT_CATEGORIES as $type => $category) {
        expect(array_key_exists($type, NotificationPrefs::TYPES))->toBeTrue();

        foreach (['de', 'en'] as $locale) {
            expect(trans("notifications.categories.$category", [], $locale))->not->toBe("notifications.categories.$category");
        }
    }

    expect(trans('notifications.categories.badges', [], 'de'))->toBe('Abzeichen')->and(trans('notifications.categories.invites', [], 'de'))->toBe('Einladungen');

    Sanctum::actingAs(giftMember());
    $prefs = $this->getJson('/api/v1/me/settings')->assertOk()->json('data.notification_prefs.types');
    expect($prefs)->toHaveKeys(['spot_alert', 'badge_unlocked', 'car_of_the_day', 'car_of_the_day_owner', 'invite_accepted']);
});

it('governs badge_unlocked, car_of_the_day and invite_accepted by the shared limit, not the owner\'s own pick', function () {
    expect(SocialPushLimiter::governs(NotificationType::BadgeUnlocked))->toBeTrue()
        ->and(SocialPushLimiter::governs(NotificationType::CarOfTheDay))->toBeTrue()
        ->and(SocialPushLimiter::governs(NotificationType::InviteAccepted))->toBeTrue()
        ->and(SocialPushLimiter::governs(NotificationType::CarOfTheDayOwner))->toBeFalse();
});

it('pushes one gift social type a day; the rest stay in the list', function () {
    $member = giftMember(['notification_prefs' => ['types' => ['badge_unlocked' => ['push' => true]]]]);
    ntfPushOn($member);
    giftNtfAt('12:00');

    app(Notifier::class)->inviteAccepted($member, 'ABCDEFGH');
    app(Notifier::class)->badgeUnlocked($member, Badge::query()->findOrFail('crew-starter'));
    app(Notifier::class)->badgeUnlocked($member, Badge::query()->findOrFail('erster-build'));

    expect(Notification::query()->where('notifiable_id', $member->id)->count())->toBe(3)
        ->and(Notification::query()->where('notifiable_id', $member->id)->whereNotNull('pushed_at')->pluck('type')->map->value->all())->toBe(['invite_accepted'])
        ->and(ntfPushes())->toHaveCount(1);

    giftNtfAt('12:00');
    $this->travel(1)->days();
    app(Notifier::class)->badgeUnlocked($member, Badge::query()->findOrFail('erster-spot'));
    expect(ntfPushes())->toHaveCount(2);
});

it('never pushes a gift social type between 22:00 and 08:00, keeps badges in-app only by default', function (string $time, bool $pushed) {
    $member = giftMember();
    ntfPushOn($member);
    giftNtfAt($time);

    app(Notifier::class)->inviteAccepted($member, 'ABCDEFGH');
    app(Notifier::class)->badgeUnlocked($member, Badge::query()->findOrFail('crew-starter'));

    expect(ntfPushes())->toHaveCount($pushed ? 1 : 0)
        ->and(Notification::query()->where('notifiable_id', $member->id)->where('type', 'badge_unlocked')->value('pushed_at'))->toBeNull();
})->with([['21:59', true], ['22:00', false], ['07:59', false], ['08:00', true]]);

it('keeps the owner\'s own Car of the Day out of the daily limit but never pushes it between 22:00 and 08:00', function (string $time, bool $pushed) {
    expect(SocialPushLimiter::keepsNightQuiet(NotificationType::CarOfTheDayOwner))->toBeTrue()
        ->and(SocialPushLimiter::keepsNightQuiet(NotificationType::SpotAlert))->toBeTrue();

    $member = giftMember();
    $car = giftCar($member, 500);
    ntfPushOn($member);
    giftNtfAt($time);

    // The day's one social push is already used: the owner's pick still pushes (ADR-513), unless it is night (a late staff replace).
    app(Notifier::class)->inviteAccepted($member, 'ABCDEFGH');
    app(Notifier::class)->carOfTheDayOwner($member, $car, '2026-07-15');

    $row = Notification::query()->where('notifiable_id', $member->id)->where('type', 'car_of_the_day_owner')->firstOrFail();
    expect($row->pushed_at !== null)->toBe($pushed)
        ->and(ntfPushes())->toHaveCount($pushed ? 2 : 0);
})->with([['18:00', true], ['21:59', true], ['22:00', false], ['23:30', false], ['07:59', false], ['08:00', true]]);

it('writes the HOME-02 rows with their details and German push texts', function () {
    $member = giftMember(['locale' => 'de']);
    $car = giftCar($member, 500);
    giftNtfAt('18:00');
    $notifier = app(Notifier::class);
    $badge = $notifier->badgeUnlocked($member, Badge::query()->findOrFail('crew-starter'));
    $owner = $notifier->carOfTheDayOwner($member, $car, '2026-07-15');
    $invite = $notifier->inviteAccepted($member, 'ABCDEFGH');
    Sanctum::actingAs($member);

    $rows = collect($this->getJson('/api/v1/notifications')->assertOk()->json('data'))->keyBy('type');

    expect($rows['badge_unlocked']['details'])->toBe(['badge_key' => 'crew-starter', 'tier' => 'bronze'])
        ->and($rows['car_of_the_day_owner']['details'])->toBe(['day' => '2026-07-15'])
        ->and($rows['invite_accepted']['details'])->toBe(['code' => 'ABCDEFGH']);

    $texts = app(NotificationTexts::class);
    $feed = app(NotificationFeed::class);
    [$badge, $owner, $invite] = [$feed->find($member, $badge->id), $feed->find($member, $owner->id), $feed->find($member, $invite->id)];
    expect($texts->push($badge, $member)['body'])->toBe('Neues Abzeichen: „Crew Starter“.')
        ->and($texts->push($invite, $member)['body'])->toContain('ABCDEFGH')
        ->and($texts->push($owner, $member)['body'])->toContain('Car of the Day')
        ->and($texts->path($badge))->toBe('/profile/badges')
        ->and($texts->path($invite))->toBe('/settings/invites');
});
