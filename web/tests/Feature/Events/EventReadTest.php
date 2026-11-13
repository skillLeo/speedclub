<?php

use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Enums\RsvpStatus;
use App\Models\User;
use Carbon\CarbonImmutable;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';

/**
 * M4.12 reads (09 §8.7, §7.10): GET events, events/pins, events/{slug}, me/events. Who sees which event, filters, the sample rule
 * and the private-location rule (never the exact place in a list, a pin or for anybody but the organiser and going members).
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->event = evEvent($this->organiser, ['title' => 'Treffen am Kai']);
});

describe('GET events/{slug}', function () {
    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        socActAs($who($this->organiser));

        $response = $this->getJson("/api/v1/events/{$this->event->slug}")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [200, null],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [200, null],
        'member who blocked the other' => [404, 'event_unavailable'],
        'member the other blocked' => [404, 'event_unavailable'],
    ]));

    it('shows the card, rules, real counts and what the reader may do', function () {
        evRsvp($this->event, User::factory()->create());
        evRsvp($this->event, User::factory()->create(), RsvpStatus::Interested);
        Sanctum::actingAs($fan = User::factory()->create());

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
            ->assertJsonPath('data.title', 'Treffen am Kai')
            ->assertJsonPath('data.organiser.username', 'jann.ptrs')
            ->assertJsonPath('data.counts', ['going' => 1, 'interested' => 1])
            ->assertJsonPath('data.rules', ['legal_only', 'no_racing'])
            ->assertJsonPath('data.can.rsvp', true)
            ->assertJsonPath('data.can.edit', false)
            ->assertJsonPath('data.review', null)
            ->assertJsonPath('data.my_rsvp', null)
            ->assertJsonPath('data.share_url', url('/e/'.$this->event->slug));
    });

    it('keeps drafts, pending and rejected events to their organiser', function (string $status) {
        $event = evEvent($this->organiser, ['status' => $status]);

        $this->getJson("/api/v1/events/{$event->slug}")->assertNotFound()->assertJsonPath('code', 'event_unavailable');
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$event->slug}")->assertNotFound()->assertJsonPath('code', 'event_unavailable');
        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$event->slug}")->assertOk()->assertJsonPath('data.status', $status);
    })->with(['draft', 'pending_review', 'rejected']);

    it('shows a followers-only event to followers and members with an answer', function () {
        $event = evEvent($this->organiser, ['visibility' => EventVisibility::Followers]);
        $follower = User::factory()->create();
        socFollow($follower, $this->organiser);

        $this->getJson("/api/v1/events/{$event->slug}")->assertNotFound();
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$event->slug}")->assertNotFound();
        Sanctum::actingAs($follower);
        $this->getJson("/api/v1/events/{$event->slug}")->assertOk();
    });

    it('hides the events of a suspended organiser and unknown slugs alike', function () {
        $this->organiser->forceFill(['status' => 'suspended'])->save();

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertNotFound()->assertJsonPath('code', 'event_unavailable');
        $this->getJson('/api/v1/events/gibt-es-nicht-123456')->assertNotFound()->assertJsonPath('code', 'event_unavailable');
    });

    it('answers 404 feature_disabled while the events flag is off', function () {
        evFlags(['events' => false]);

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->getJson('/api/v1/events')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('the private place (after_rsvp)', function () {
    beforeEach(function () {
        $this->private = evPrivateEvent($this->organiser, ['venue_name' => 'Halle Geheim 7', 'street' => 'Hinterhofweg 99', 'postcode' => '20999', 'lat' => 53.61234, 'lng' => 10.01234]);
    });

    it('gives the exact place to the organiser and going members only', function (string $who, bool $exact) {
        $viewer = match ($who) {
            'organiser' => $this->organiser,
            'guest' => null,
            default => User::factory()->create(),
        };

        if ($viewer !== null && in_array($who, ['going', 'interested', 'waitlist'], true)) {
            evRsvp($this->private, $viewer, RsvpStatus::from($who));
        }

        socActAs($viewer);
        $body = $this->getJson("/api/v1/events/{$this->private->slug}")->assertOk()->json();

        expect($body['data']['location']['exact'])->toBe($exact)
            ->and(str_contains(evStrings($body), 'Hinterhofweg'))->toBe($exact)
            ->and(str_contains(evStrings($body), 'Halle Geheim'))->toBe($exact)
            ->and(str_contains(evStrings($body), '53.61234'))->toBe($exact)
            ->and($body['data']['location']['city'])->toBe('Hamburg')
            ->and($body['data']['location']['area']['lat'])->not->toBeNull();
    })->with([
        'organiser' => ['organiser', true],
        'going member' => ['going', true],
        'interested member' => ['interested', false],
        'waitlisted member' => ['waitlist', false],
        'other member' => ['other', false],
        'guest' => ['guest', false],
    ]);

    it('never puts it into a list, a pin or my events, not even for the organiser or a going member', function () {
        $going = User::factory()->create();
        evRsvp($this->private, $going);

        foreach ([$this->organiser, $going] as $viewer) {
            Sanctum::actingAs($viewer);

            foreach (['/api/v1/events', '/api/v1/events/pins', '/api/v1/me/events?tab=going', '/api/v1/me/events?tab=organised'] as $uri) {
                $body = evStrings($this->getJson($uri)->assertOk()->json());
                expect($body)->not->toContain('Hinterhofweg')->not->toContain('Halle Geheim')->not->toContain('53.61234')->not->toContain('20999');
            }
        }
    });

    it('keeps it out of the calendar file of anybody else and puts it into a going member\'s signed one', function () {
        $public = $this->get("/e/{$this->private->slug}.ics")->assertOk()->assertHeader('Content-Type', 'text/calendar; charset=utf-8');
        expect($public->getContent())->toContain('LOCATION:Hamburg')->not->toContain('Hinterhofweg')->not->toContain('GEO:');

        $going = User::factory()->create();
        evRsvp($this->private, $going);
        Sanctum::actingAs($going);
        $url = $this->getJson("/api/v1/events/{$this->private->slug}")->json('data.calendar_url');
        expect($url)->toContain('signature=');

        $signed = $this->get($url)->assertOk()->getContent();
        expect($signed)->toContain('Hinterhofweg')->toContain('GEO:53.612340;10.012340');

        // Withdrawn since: the same link falls back to the city.
        $this->deleteJson("/api/v1/events/{$this->private->slug}/rsvp")->assertOk();
        expect($this->get($url)->assertOk()->getContent())->not->toContain('Hinterhofweg');

        // A tampered link is a guest's.
        expect($this->get(str_replace('signature=', 'signature=x', $url))->assertOk()->getContent())->not->toContain('Hinterhofweg');
    });

    it('serves the API calendar file by the reader behind the token', function () {
        $going = User::factory()->create();
        evRsvp($this->private, $going);

        expect($this->get("/api/v1/events/{$this->private->slug}.ics")->assertOk()->getContent())->not->toContain('Hinterhofweg');
        Sanctum::actingAs($going);
        expect($this->get("/api/v1/events/{$this->private->slug}.ics")->assertOk()->getContent())->toContain('Hinterhofweg')->toContain('BEGIN:VEVENT');
    });
});

describe('GET events', function () {
    it('lists published, upcoming, public events by start, without blocked organisers', function () {
        $later = evEvent(null, ['starts_at' => now()->addDays(20), 'ends_at' => now()->addDays(20)->addHours(2)]);
        evEvent(null, ['status' => EventStatus::PendingReview]);
        evEvent(null, ['status' => EventStatus::Cancelled]);
        evEvent(null, ['starts_at' => now()->subDays(2), 'ends_at' => now()->subDays(2)->addHours(2)]);
        evEvent(null, ['visibility' => EventVisibility::Unlisted]);
        $blocked = evEvent();
        $viewer = User::factory()->create();
        socBlock($viewer, $blocked->organiser);

        $this->getJson('/api/v1/events')->assertOk()->assertJsonCount(3, 'data');
        Sanctum::actingAs($viewer);
        $this->getJson('/api/v1/events')->assertOk()
            ->assertJsonPath('data.0.id', $this->event->id)
            ->assertJsonPath('data.1.id', $later->id)
            ->assertJsonCount(2, 'data');
    });

    it('filters by type, weekend, distance and the map view', function () {
        $munich = evEvent(null, ['type' => 'track_day', 'lat' => 48.1351, 'lng' => 11.5820, 'area_lat' => 48.125, 'area_lng' => 11.575]);

        $this->getJson('/api/v1/events?type=track_day')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $munich->id);
        $this->getJson('/api/v1/events?lat=53.55&lng=10.0&radius_km=30')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $this->event->id)
            ->assertJsonPath('data.0.distance_km', fn (mixed $km): bool => is_int($km) && $km < 10);
        $this->getJson('/api/v1/events/pins?bbox=11.0,47.9,12.0,48.5')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $munich->id);

        $saturday = now('Europe/Berlin')->next(CarbonImmutable::SATURDAY)->setTime(14, 0)->utc();
        $weekend = evEvent(null, ['starts_at' => $saturday, 'ends_at' => $saturday->copy()->addHours(3)]);
        $ids = collect($this->getJson('/api/v1/events?when=weekend')->assertOk()->json('data'))->pluck('id');
        expect($ids)->toContain($weekend->id);
    });

    it('validates the filters', function () {
        $this->getJson('/api/v1/events?when=gestern')->assertUnprocessable();
        $this->getJson('/api/v1/events?lat=53')->assertUnprocessable();
        $this->getJson('/api/v1/events?bbox=1,2,3')->assertUnprocessable();
    });

    it('pages with a cursor', function () {
        evEvent(null, ['starts_at' => now()->addDays(8), 'ends_at' => now()->addDays(8)->addHour()]);
        evEvent(null, ['starts_at' => now()->addDays(9), 'ends_at' => now()->addDays(9)->addHour()]);

        $first = $this->getJson('/api/v1/events?per_page=2')->assertOk()->assertJsonCount(2, 'data');
        $next = $first->json('meta.next_cursor');
        $this->getJson('/api/v1/events?per_page=2&cursor='.$next)->assertOk()->assertJsonCount(1, 'data');
    });
});

describe('sample events (09 §8.19)', function () {
    it('shows them with the Beispiel flag and without counts while samples are on, and hides them when off', function () {
        $editorial = evOrganiser(['username' => 'speedclub.editorial', 'is_sample' => true, 'is_editorial' => true]);
        $sample = evEvent($editorial, ['is_sample' => true, 'title' => 'Beispiel-Treffen Hafen']);
        evRsvp($sample, User::factory()->create());

        $this->getJson("/api/v1/events/{$sample->slug}")->assertOk()
            ->assertJsonPath('data.is_sample', true)
            ->assertJsonPath('data.counts', null)
            ->assertJsonPath('data.spots_left', null);
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$sample->slug}/attendees")->assertOk()->assertJsonCount(0, 'data');

        evFlags(['editorial_samples' => false]);
        $this->getJson("/api/v1/events/{$sample->slug}")->assertNotFound()->assertJsonPath('code', 'event_unavailable');
        expect(collect($this->getJson('/api/v1/events')->json('data'))->pluck('id'))->not->toContain($sample->id);
        $this->getJson('/api/v1/events/pins')->assertOk()->assertJsonCount(1, 'data');
    });
});

describe('GET me/events', function () {
    it('lists my answers, my own events of every status and the past', function () {
        $me = evOrganiser();
        $going = evEvent();
        $waiting = evEvent();
        $interested = evEvent();
        $past = evEvent(null, ['starts_at' => now()->subDays(3), 'ends_at' => now()->subDays(3)->addHours(2)]);
        evRsvp($going, $me);
        evRsvp($waiting, $me, RsvpStatus::Waitlist);
        evRsvp($interested, $me, RsvpStatus::Interested);
        evRsvp($past, $me);
        $draft = evEvent($me, ['status' => EventStatus::Draft]);
        Sanctum::actingAs($me);

        expect(collect($this->getJson('/api/v1/me/events')->assertOk()->json('data'))->pluck('id')->sort()->values()->all())->toBe(collect([$going->id, $waiting->id])->sort()->values()->all())
            ->and($this->getJson('/api/v1/me/events?tab=interested')->json('data.0.id'))->toBe($interested->id)
            ->and($this->getJson('/api/v1/me/events?tab=organised')->json('data.0.id'))->toBe($draft->id)
            ->and($this->getJson('/api/v1/me/events?tab=past')->json('data.0.id'))->toBe($past->id);
    });

    it('needs a member', function () {
        $this->getJson('/api/v1/me/events')->assertUnauthorized();
    });
});
