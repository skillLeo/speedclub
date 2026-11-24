<?php

use App\Enums\NotificationType;
use App\Enums\RsvpStatus;
use App\Mail\EventNearbyMail;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Services\Events\SendNearbyEventsDigest;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M5.6 "Neue Treffen in deiner Nähe" (m5.6-contract §6): weekly from Thursday 18:00 Berlin, opt-in (off by default), around the SET-11
 * region only, nothing new → nothing sent, one row (and at most one push) a week, quiet hours and the social limit, the e-mail with its
 * one-click unsubscribe.
 */
function m56Thursday(string $time = '18:05'): void
{
    test()->travelTo(CarbonImmutable::parse("2026-11-19 $time", 'Europe/Berlin'));
}

/** A member in Hamburg with the switches given (push and/or email). */
function m56NearbyMember(array $channels = ['push' => true], array $attributes = []): User
{
    return User::factory()->create([
        'home_region_label' => 'Hamburg',
        'home_region_lat' => 53.55,
        'home_region_lng' => 9.99,
        'notification_prefs' => ['types' => ['event_nearby' => $channels]],
        ...$attributes,
    ]);
}

/** A public meet near Hamburg, published two days ago, starting in $days days. */
function m56NearbyEvent(int $days = 5, array $attributes = []): Event
{
    return evEvent(null, [
        'starts_at' => now()->addDays($days)->setTime(18, 0),
        'ends_at' => now()->addDays($days)->setTime(21, 0),
        'published_at' => now()->subDays(2),
        ...$attributes,
    ]);
}

beforeEach(function () {
    evFlags();
    Mail::fake();
    m56Thursday();
});

it('is opt-in: every channel of event_nearby starts off and it is patchable in SET-09', function () {
    $member = User::factory()->create();

    expect(NotificationPrefs::defaults()['types']['event_nearby'])->toBe(['push' => false, 'email' => false, 'web_push' => false])
        ->and(NotificationType::EventNearby->category())->toBe('events')
        ->and(NotificationType::EventNearby->pushPreference())->toBe('event_nearby')
        ->and(trans('notifications.categories.events_nearby', [], 'de'))->toBe('Treffen in deiner Nähe')
        ->and(trans('notifications.categories.events_nearby', [], 'en'))->toBe('Meets near you');

    Sanctum::actingAs($member);
    $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.notification_prefs.types.event_nearby.push', false);
    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['event_nearby' => ['email' => true]]]])->assertOk()
        ->assertJsonPath('data.notification_prefs.types.event_nearby.email', true)
        ->assertJsonPath('data.notification_prefs.types.event_nearby.push', false);
});

it('tells an opted-in member with a home region about new meets nearby, with push and e-mail', function () {
    $member = m56NearbyMember(['push' => true, 'email' => true]);
    ntfPushOn($member);
    $first = m56NearbyEvent(3, ['title' => 'Cars & Coffee am Hafen']);
    m56NearbyEvent(6);
    m56NearbyEvent(9);

    $result = app(SendNearbyEventsDigest::class)->run();

    $row = Notification::query()->where('notifiable_id', $member->id)->sole();
    expect($result['sent'])->toBe(1)->and($result['week'])->toBe('2026-W47')->and($result['done'])->toBeTrue()
        ->and($row->type)->toBe(NotificationType::EventNearby)
        ->and($row->data['count'])->toBe(3)
        ->and($row->data['event_id'])->toBe($first->id)
        ->and($row->getAttribute('pushed_at'))->not->toBeNull()
        ->and(ntfPushes())->toHaveCount(1)
        ->and(evStrings(ntfPushes()[0]))->toContain('Neue Treffen in deiner N')->toContain('Cars & Coffee am Hafen und 2 weitere');

    Mail::assertQueued(EventNearbyMail::class, fn (EventNearbyMail $mail): bool => $mail->hasTo($member->email) && $mail->total === 3 && count($mail->events) === 3
        && str_contains($mail->unsubscribeUrl, 'signature='));

    Sanctum::actingAs($member);
    $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('data.0.type', 'event_nearby')
        ->assertJsonPath('data.0.details.count', 3)->assertJsonPath('data.0.event.slug', $first->slug);
});

it('sends nothing without the opt-in, without a home region, or when nothing is new', function () {
    m56NearbyEvent();
    $off = m56NearbyMember(['push' => false, 'email' => false]);
    $untouched = User::factory()->create(['home_region_lat' => 53.55, 'home_region_lng' => 9.99]);
    $noRegion = m56NearbyMember(['push' => true, 'email' => true], ['home_region_lat' => null, 'home_region_lng' => null, 'home_region_label' => null]);

    expect(app(SendNearbyEventsDigest::class)->run()['sent'])->toBe(0)
        ->and(Notification::query()->count())->toBe(0);
    Mail::assertNothingQueued();

    Event::query()->delete();
    $member = m56NearbyMember(['push' => true, 'email' => true]);
    expect(app(SendNearbyEventsDigest::class)->run()['sent'])->toBe(0);
    Mail::assertNothingQueued();
    expect([$off, $untouched, $noRegion, $member])->toHaveCount(4);
});

it('names only public, non-sample meets nearby, new this week, within two weeks, not the member\'s own, not answered, not across a block', function () {
    $member = m56NearbyMember(['push' => true]);
    $good = m56NearbyEvent(4);
    m56NearbyEvent(4, ['lat' => 48.137, 'lng' => 11.575, 'area_lat' => 48.15, 'area_lng' => 11.6, 'city' => 'München']);
    m56NearbyEvent(4, ['published_at' => now()->subDays(10)]);
    m56NearbyEvent(16);
    m56NearbyEvent(4, ['is_sample' => true]);
    m56NearbyEvent(4, ['visibility' => 'followers']);
    m56NearbyEvent(4, ['organiser_id' => $member->id]);
    $answered = m56NearbyEvent(4);
    evRsvp($answered, $member, RsvpStatus::Interested);
    $blocked = m56NearbyEvent(4);
    socBlock($blocked->organiser, $member);

    $ids = app(SendNearbyEventsDigest::class)->events($member, 53.55, 9.99)->pluck('id')->all();

    expect($ids)->toBe([$good->id]);
});

it('tells a member once a week: a rerun changes nothing, next week tells again', function () {
    $member = m56NearbyMember(['push' => true, 'email' => true]);
    ntfPushOn($member);
    m56NearbyEvent();

    app(SendNearbyEventsDigest::class)->run();
    $this->travel(30)->minutes();
    m56NearbyEvent(7);
    app(SendNearbyEventsDigest::class)->run();

    expect(Notification::query()->where('notifiable_id', $member->id)->count())->toBe(1)->and(ntfPushes())->toHaveCount(1);
    Mail::assertQueuedCount(1);

    $this->travelTo(CarbonImmutable::parse('2026-11-26 18:05', 'Europe/Berlin'));
    m56NearbyEvent(3);
    app(SendNearbyEventsDigest::class)->run();

    expect(Notification::query()->where('notifiable_id', $member->id)->pluck('group_key')->sort()->values()->all())->toBe(['event_nearby:2026-W47', 'event_nearby:2026-W48']);
});

it('runs only inside the Thursday window', function (string $local, bool $due) {
    $this->travelTo(CarbonImmutable::parse($local, 'Europe/Berlin'));

    expect(app(SendNearbyEventsDigest::class)->run()['due'])->toBe($due);
})->with([
    'Thursday 17:59' => ['2026-11-19 17:59', false],
    'Thursday 18:00' => ['2026-11-19 18:00', true],
    'Friday 09:59' => ['2026-11-20 09:59', true],
    'Friday 10:00' => ['2026-11-20 10:00', false],
    'Monday noon' => ['2026-11-23 12:00', false],
]);

it('holds the push back in the member\'s quiet hours and pushes in the morning ("moves to 08:00")', function () {
    $member = m56NearbyMember(['push' => true], ['notification_prefs' => [
        'types' => ['event_nearby' => ['push' => true]],
        'quiet_hours' => ['enabled' => true, 'from' => '17:00', 'to' => '08:00'],
    ]]);
    ntfPushOn($member);
    m56NearbyEvent();

    app(SendNearbyEventsDigest::class)->run();
    $row = Notification::query()->where('notifiable_id', $member->id)->sole();
    expect($row->getAttribute('pushed_at'))->toBeNull()->and(ntfPushes())->toHaveCount(0);

    $this->travelTo(CarbonImmutable::parse('2026-11-20 08:10', 'Europe/Berlin'));
    expect(app(SendNearbyEventsDigest::class)->run()['pushed'])->toBe(1)
        ->and($row->refresh()->getAttribute('pushed_at'))->not->toBeNull()
        ->and(ntfPushes())->toHaveCount(1);
});

it('shares the one social push of the day with the gift types', function () {
    $member = m56NearbyMember(['push' => true]);
    ntfPushOn($member);
    m56NearbyEvent();
    app(Notifier::class)->inviteAccepted($member, 'ABCDEFGH');

    app(SendNearbyEventsDigest::class)->run();

    expect(Notification::query()->where('notifiable_id', $member->id)->where('type', 'event_nearby')->value('pushed_at'))->toBeNull()
        ->and(ntfPushes())->toHaveCount(1);
});

it('resumes where the last run stopped', function () {
    config(['speedclub.events.nearby_chunk' => 1]);
    $members = collect(range(1, 3))->map(fn () => m56NearbyMember(['push' => true]));
    m56NearbyEvent();

    $first = app(SendNearbyEventsDigest::class)->run(maxSeconds: 0);
    $rest = app(SendNearbyEventsDigest::class)->run();

    expect($first['sent'])->toBe(1)->and($first['done'])->toBeFalse()
        ->and($rest['sent'])->toBe(2)->and($rest['done'])->toBeTrue()
        ->and(Notification::query()->where('type', 'event_nearby')->count())->toBe(3)
        ->and($members)->toHaveCount(3);
});

it('asks on GET and changes nothing, so a mail scanner opening the link unsubscribes nobody', function () {
    $member = m56NearbyMember(['push' => true, 'email' => true]);
    $url = SendNearbyEventsDigest::unsubscribeUrl($member);

    expect($url)->toContain('/abbestellen/treffen/'.$member->id)->toContain('signature=')->toContain('lang=de');

    $page = $this->get($url)->assertOk()
        ->assertSee('Wöchentliche Treffen-Mail abbestellen?')
        ->assertSee('data-testid="WEB-UNSUB.confirm"', false)
        ->assertSee('method="post"', false);
    expect((string) $page->headers->get('Cache-Control'))->toContain('no-store');
    $this->get($url)->assertOk();

    expect(NotificationPrefs::for($member->refresh())['types']['event_nearby'])->toMatchArray(['email' => true, 'push' => true]);
});

it('unsubscribes on the page\'s POST, idempotently, and leaves the push and every other choice on', function () {
    $member = m56NearbyMember(['push' => true, 'email' => true], ['notification_prefs' => [
        'types' => ['event_nearby' => ['push' => true, 'email' => true], 'event_reminder' => ['email' => true]],
    ]]);
    $url = SendNearbyEventsDigest::unsubscribeUrl($member);

    $this->post($url)->assertOk()->assertSee('Abbestellt')->assertSee('data-step="done"', false);
    $this->post($url)->assertOk();

    $prefs = NotificationPrefs::for($member->refresh());
    expect($prefs['types']['event_nearby'])->toMatchArray(['email' => false, 'push' => true])
        ->and($prefs['types']['event_reminder']['email'])->toBeTrue();
});

it('takes the mail client\'s RFC 8058 one-click POST to the same signed URL', function () {
    $member = m56NearbyMember(['email' => true]);
    $url = SendNearbyEventsDigest::unsubscribeUrl($member);

    $this->call('POST', $url, ['List-Unsubscribe' => 'One-Click'], [], [], ['CONTENT_TYPE' => 'application/x-www-form-urlencoded'])->assertOk();

    expect(NotificationPrefs::for($member->refresh())['types']['event_nearby']['email'])->toBeFalse();
});

it('refuses a tampered, foreign or expired link with 403 and changes nothing', function () {
    $member = m56NearbyMember(['email' => true]);
    $other = m56NearbyMember(['email' => true]);
    $url = SendNearbyEventsDigest::unsubscribeUrl($member);

    $this->post(str_replace('signature=', 'signature=0', $url))->assertForbidden()->assertSee('Link nicht mehr gültig');
    $this->post(str_replace($member->id, $other->id, $url))->assertForbidden();
    $this->travel(61)->days();
    $this->post($url)->assertForbidden();
    $this->get('/abbestellen/wochenpost/'.$member->id)->assertNotFound();

    expect(NotificationPrefs::for($member->refresh())['types']['event_nearby']['email'])->toBeTrue()
        ->and(NotificationPrefs::for($other->refresh())['types']['event_nearby']['email'])->toBeTrue();
});

it('shows the page in English for an English member', function () {
    $member = m56NearbyMember(['email' => true], ['locale' => 'en']);

    $this->get(SendNearbyEventsDigest::unsubscribeUrl($member))->assertOk()->assertSee('Unsubscribe from the weekly meets e-mail?');
});

it('builds the e-mail with dates, cities and the List-Unsubscribe headers, in German and English', function () {
    $mail = new EventNearbyMail([['title' => 'Cars & Coffee am Hafen', 'city' => 'Hamburg', 'starts_at' => '2026-11-24T18:00:00+01:00', 'slug' => 'cars-coffee-abc123']], 3, 'https://example.test/u', 'Hamburg');

    $mail->assertSeeInText('Cars & Coffee am Hafen');
    $mail->assertSeeInText('Hamburg');
    $mail->assertSeeInText('2 weitere');
    expect($mail->headers()->text)->toBe(['List-Unsubscribe' => '<https://example.test/u>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']);

    // A rendered mail keeps its text: English is a new instance.
    $english = (new EventNearbyMail([['title' => 'Cars & Coffee am Hafen', 'city' => 'Hamburg', 'starts_at' => '2026-11-24T18:00:00+01:00', 'slug' => 'cars-coffee-abc123']], 3, 'https://example.test/u', null))->locale('en');
    $english->assertSeeInText('New meets near you');
    $english->assertSeeInText('your region');
});
