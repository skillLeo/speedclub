<?php

use App\Actions\Admin\Events\ReviewEvent;
use App\Enums\EventStatus;
use App\Enums\NotificationType;
use App\Enums\RsvpStatus;
use App\Jobs\Events\NotifyEventChange;
use App\Models\Notification;
use App\Models\User;
use App\Services\Events\EventCalendar;
use App\Services\Events\EventHousekeeping;
use App\Services\Events\EventReminders;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * M4.12 security review (SEC-412-01, SEC-412-02, L1–L5, ADR-113 note): the probes of the audit as gates. Each one failed before the fix.
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
});

function esrStaff(): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole('moderator'));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

describe('SEC-412-01 pre-moderation', function () {
    it('refuses changes and a new cover while staff review the event', function () {
        Storage::fake('public');
        Storage::fake('local');
        $event = evPrivateEvent($this->organiser, ['status' => EventStatus::PendingReview, 'published_at' => null, 'submitted_at' => now()->subHour(), 'venue_name' => 'Harmloser Parkplatz']);
        Sanctum::actingAs($this->organiser);

        $this->patchJson("/api/v1/events/{$event->slug}", ['venue_name' => 'Ganz anderer Ort', 'title' => 'Ganz anderer Titel'])
            ->assertStatus(409)->assertJsonPath('code', 'event_in_review');
        $this->post("/api/v1/events/{$event->slug}/cover", ['file' => UploadedFile::fake()->image('cover.jpg', 1600, 900)], ['Accept' => 'application/json'])
            ->assertStatus(409)->assertJsonPath('code', 'event_in_review');

        expect($event->fresh()?->getAttribute('venue_name'))->toBe('Harmloser Parkplatz')
            ->and($event->fresh()?->getAttribute('cover_media_id'))->toBeNull();
    });

    it('sends a published private-place event back to review when title, description or place change, and staff see what changed', function () {
        $event = evPrivateEvent($this->organiser, ['published_at' => now()->subDay(), 'reviewed_at' => now()->subDay()]);
        Sanctum::actingAs($this->organiser);

        $this->patchJson("/api/v1/events/{$event->slug}", ['venue_name' => 'Dritter Ort', 'city' => 'Frankfurt', 'title' => 'Nach der Freigabe'])
            ->assertOk()->assertJsonPath('data.status', 'pending_review');

        $fresh = $event->fresh();
        expect($fresh?->status)->toBe(EventStatus::PendingReview)
            ->and($fresh?->getAttribute('review_changes'))->toEqualCanonicalizing(['venue_name', 'city', 'title']);

        // While in review it is gone from the public lists, and a second change waits for the decision.
        $this->patchJson("/api/v1/events/{$event->slug}", ['title' => 'Noch einmal'])->assertStatus(409)->assertJsonPath('code', 'event_in_review');
    });

    it('keeps a published event of an established organiser with a public place published (post-moderation)', function () {
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        $event = evEvent($this->organiser, ['published_at' => now()->subDay()]);
        Sanctum::actingAs($this->organiser);

        $this->patchJson("/api/v1/events/{$event->slug}", ['title' => 'Neuer Titel', 'description' => 'Neuer Text.'])->assertOk()->assertJsonPath('data.status', 'published');
    });

    it('sends a pre-moderated published event back to review for a new cover', function () {
        Storage::fake('public');
        Storage::fake('local');
        $event = evPrivateEvent($this->organiser, ['published_at' => now()->subDay(), 'reviewed_at' => now()->subDay()]);
        Sanctum::actingAs($this->organiser);

        $this->post("/api/v1/events/{$event->slug}/cover", ['file' => UploadedFile::fake()->image('cover.jpg', 1600, 900)], ['Accept' => 'application/json'])->assertCreated();

        expect($event->fresh()?->status)->toBe(EventStatus::PendingReview)->and($event->fresh()?->getAttribute('review_changes'))->toBe(['cover']);
    });

    it('approves only the version staff looked at, and tells attendees about a new place with the approval', function () {
        Queue::fake();
        $event = evPrivateEvent($this->organiser, ['status' => EventStatus::PendingReview, 'published_at' => now()->subWeek(), 'submitted_at' => now()->subHour(),
            'review_changes' => ['venue_name']]);
        $seen = ReviewEvent::version($event);
        esrStaff();

        // M4.17 (ADR-439 optimistic locking): the version is required, and another one is "changed meanwhile" (409 for JSON).
        $this->post("/admin/events/{$event->id}/approve")->assertSessionHasErrors('version');
        $this->post("/admin/events/{$event->id}/approve", ['version' => '2020-01-01T00:00:00+00:00'])->assertSessionHasErrors(['version' => 'events.conflict.changed']);
        expect($event->fresh()?->status)->toBe(EventStatus::PendingReview);

        $this->post("/admin/events/{$event->id}/approve", ['version' => $seen])->assertSessionHas('success', 'events.flash.approved');

        $fresh = $event->fresh();
        expect($fresh?->status)->toBe(EventStatus::Published)
            ->and($fresh?->getAttribute('review_changes'))->toBeNull()
            ->and($fresh?->getAttribute('published_at')?->lessThan(now()->subDays(6)))->toBeTrue();
        Queue::assertPushed(NotifyEventChange::class);
    });

    it('shows the version and the changed fields in the queue', function () {
        evPrivateEvent($this->organiser, ['status' => EventStatus::PendingReview, 'published_at' => now()->subWeek(), 'submitted_at' => now()->subHour(), 'review_changes' => ['title']]);
        esrStaff();

        $this->get('/admin/events')->assertOk()->assertInertia(fn ($page) => $page
            ->where('rows.data.0.changed_since_review', ['title'])
            ->where('rows.data.0.version', fn ($version): bool => is_string($version) && $version !== ''));
    });
});

describe('SEC-412-02 change notifications', function () {
    it('keeps one change row per attendee and event, however often time or place change', function () {
        $event = evEvent($this->organiser);
        $member = User::factory()->create();
        evRsvp($event, $member);
        Sanctum::actingAs($this->organiser);
        $start = now()->addDays(7)->setTime(18, 0);

        foreach (range(0, 3) as $i) {
            $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => $start->copy()->addMinutes($i % 2 === 0 ? 5 : 0)->toIso8601String()])->assertOk();
        }

        expect(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::EventUpdate)->count())->toBe(1);
    });

    it('limits changes of time or place per event and hour', function () {
        config(['speedclub.events.changes_per_hour' => 2]);
        $event = evEvent($this->organiser);
        RateLimiter::clear('event-changes:'.$event->id);
        Sanctum::actingAs($this->organiser);

        $start = $event->starts_at;
        $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => $start?->addMinutes(10)->toIso8601String()])->assertOk();
        $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => $start?->addMinutes(20)->toIso8601String()])->assertOk();
        $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => $start?->addMinutes(30)->toIso8601String()])
            ->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
        // Text-only edits are not counted.
        $this->patchJson("/api/v1/events/{$event->slug}", ['description' => 'Bitte leise anfahren.'])->assertOk();
    });

    it('does not repeat a reminder when the start moves back and forth around it', function () {
        $event = evEvent($this->organiser, ['starts_at' => now()->addHours(20), 'ends_at' => now()->addHours(23)]);
        $member = User::factory()->create();
        evRsvp($event, $member);
        app(EventReminders::class)->run();
        expect(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::EventReminder)->count())->toBe(1);

        Sanctum::actingAs($this->organiser);
        $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => now()->addHours(21)->toIso8601String(), 'ends_at' => now()->addHours(23)->toIso8601String()])->assertOk();
        app(EventReminders::class)->run();
        expect(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::EventReminder)->count())->toBe(1);

        // Moved by days: the reminder is due again for the new date.
        $this->patchJson("/api/v1/events/{$event->slug}", ['starts_at' => now()->addDays(5)->toIso8601String(), 'ends_at' => now()->addDays(5)->addHours(3)->toIso8601String()])->assertOk();
        expect($event->fresh()?->getAttribute('reminded_24h_at'))->toBeNull();
        app(EventReminders::class)->run(CarbonImmutable::now()->addDays(4)->addHours(2));
        expect(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::EventReminder)->count())->toBe(2);
    });
});

it('L1: gives members a cursor without answer times', function () {
    $event = evEvent($this->organiser);
    evRsvp($event, User::factory()->create(['username' => 'anna.e46']), RsvpStatus::Going, ['status_at' => now()->subDays(3)->setTime(3, 17, 42)]);
    evRsvp($event, User::factory()->create(['username' => 'ben.r34']), RsvpStatus::Going, ['status_at' => now()->subDay()->setTime(23, 5, 9)]);
    Sanctum::actingAs(User::factory()->create());

    $first = $this->getJson("/api/v1/events/{$event->slug}/attendees?per_page=1")->assertOk();
    $decoded = (string) base64_decode(strtr((string) $first->json('meta.next_cursor'), '-_', '+/'));
    expect($first->json('data.0.status_at'))->toBeNull()
        ->and($decoded)->not->toContain('status_at')->not->toContain('event_rsvps.id')
        ->and($first->json('data.0.member.username') ?? $first->json('data.0.username'))->toBe('anna.e46');

    $this->getJson("/api/v1/events/{$event->slug}/attendees?per_page=1&cursor=".urlencode((string) $first->json('meta.next_cursor')))->assertOk()
        ->assertJsonCount(1, 'data');
});

it('L2: lets only the organiser and going members read the updates of a private-place event', function () {
    $event = evPrivateEvent($this->organiser, ['capacity' => 1]);
    evRsvp($event, User::factory()->create());
    $waiting = User::factory()->create();
    $interested = User::factory()->create();
    evRsvp($event, $waiting, RsvpStatus::Waitlist);
    evRsvp($event, $interested, RsvpStatus::Interested);

    Sanctum::actingAs($this->organiser);
    $this->postJson("/api/v1/events/{$event->slug}/updates", ['body' => 'Treffpunkt: Hinterhof Musterweg 7, Tor 2'])->assertCreated();

    foreach ([$waiting, $interested] as $member) {
        Sanctum::actingAs($member);
        $this->getJson("/api/v1/events/{$event->slug}/updates")->assertForbidden();
    }

    // A public place: everybody with an answer still reads them.
    $public = evEvent($this->organiser);
    evRsvp($public, $interested, RsvpStatus::Interested);
    $this->getJson("/api/v1/events/{$public->slug}/updates")->assertOk();
});

it('L3: takes the exact place out of a signed calendar file once the member is suspended or closed', function () {
    $event = evPrivateEvent($this->organiser, ['street' => 'Geheimweg 42']);
    $member = User::factory()->create();
    evRsvp($event, $member);
    $url = app(EventCalendar::class)->urlFor($event, $member);

    expect($this->get($url)->assertOk()->getContent())->toContain('Geheimweg');

    $member->forceFill(['status' => 'suspended'])->save();
    expect((string) $this->get($url)->getContent())->not->toContain('Geheimweg');

    $member->forceFill(['status' => 'deactivated'])->save();
    expect((string) $this->get($url)->getContent())->not->toContain('Geheimweg');
});

it('L4: counts neither removed nor rejected events as approved ones', function () {
    evEvent($this->organiser, ['published_at' => now()->subMonth(), 'removed_at' => now()->subWeek()]);
    evEvent($this->organiser, ['published_at' => now()->subMonth(), 'status' => EventStatus::Rejected]);
    $draft = evEvent($this->organiser, ['status' => EventStatus::Draft, 'published_at' => null]);
    Sanctum::actingAs($this->organiser);

    $this->postJson("/api/v1/events/{$draft->slug}/submit")->assertOk()->assertJsonPath('data.status', 'pending_review');
});

it('L5: keeps the geocoder for members who may organise', function () {
    config(['speedclub.geocode.contact_email' => 'kontakt@example.org']);
    Cache::flush();
    Http::fake(['nominatim.openstreetmap.org/*' => Http::response([])]);

    Sanctum::actingAs(User::factory()->create(['created_at' => now()->subDays(3)]));
    $this->getJson('/api/v1/geocode?q=Hamburg')->assertForbidden()->assertJsonPath('code', 'organiser_not_eligible');
    Sanctum::actingAs(User::factory()->unverified()->create(['created_at' => now()->subDays(30)]));
    $this->getJson('/api/v1/geocode?q=Hamburg')->assertForbidden()->assertJsonPath('code', 'email_not_verified');
    Http::assertNothingSent();

    Sanctum::actingAs($this->organiser);
    $this->getJson('/api/v1/geocode?q=Hamburg')->assertOk();
});

it('ADR-113: clears the exact private place 30 days after the event, keeping the city and the area point', function () {
    $old = evPrivateEvent($this->organiser, ['starts_at' => now()->subDays(40), 'ends_at' => now()->subDays(40)->addHours(3), 'street' => 'Geheimweg 42']);
    $recent = evPrivateEvent($this->organiser, ['starts_at' => now()->subDays(5), 'ends_at' => now()->subDays(5)->addHours(3), 'street' => 'Geheimweg 43']);
    $public = evEvent($this->organiser, ['starts_at' => now()->subDays(40), 'ends_at' => now()->subDays(40)->addHours(3), 'street' => 'Hafenstraße 1']);

    expect(app(EventHousekeeping::class)->run()['places_cleared'])->toBe(1);

    $cleared = $old->fresh();
    expect($cleared?->getAttribute('street'))->toBeNull()
        ->and($cleared?->getAttribute('lat'))->toBeNull()
        ->and($cleared?->city)->not->toBeNull()
        ->and($cleared?->getAttribute('area_lat'))->not->toBeNull()
        ->and($recent->fresh()?->getAttribute('street'))->toBe('Geheimweg 43')
        ->and($public->fresh()?->getAttribute('street'))->toBe('Hafenstraße 1');
});

it('F: never lets more members go than the capacity', function () {
    $event = evEvent($this->organiser, ['capacity' => 3]);

    foreach (range(1, 5) as $n) {
        Sanctum::actingAs(User::factory()->create());
        $this->putJson("/api/v1/events/{$event->slug}/rsvp", ['status' => 'going'])->assertOk();
    }

    expect($event->rsvps()->where('status', 'going')->count())->toBe(3)
        ->and($event->rsvps()->where('status', 'waitlist')->count())->toBe(2);
});
