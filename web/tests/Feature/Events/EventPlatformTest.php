<?php

use App\Enums\EventStatus;
use App\Enums\ReportReason;
use App\Enums\ReportTargetType;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\ModerationCase;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use App\Services\Moderation\ContentRemoval;
use App\Services\Moderation\ContentRestoration;
use App\Services\Showcase\ShowcaseEvents;
use App\Services\Showcase\ShowcasePurge;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EventTestHelpers.php';
require_once __DIR__.'/../Moderation/ModerationTestHelpers.php';

/**
 * M4.12 around the events: reports and moderation (target event), the member export (events.json), the sample events of the showcase
 * and the geocoding proxy.
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->event = evEvent($this->organiser, ['title' => 'Mitternachtsrennen']);
});

describe('reports (target event)', function () {
    it('takes a report on an event the reporter can see, with street racing as the reason', function () {
        Sanctum::actingAs($reporter = User::factory()->create());

        $this->postJson('/api/v1/reports', ['target_type' => 'event', 'target_id' => $this->event->id, 'reason' => 'illegal', 'sub_reason' => 'street_racing', 'good_faith' => true, 'details' => 'Rennen auf der Landstraße angekündigt.'])->assertCreated();
        $case = ModerationCase::query()->sole();
        expect($case->target_type)->toBe(ReportTargetType::Event)
            ->and($case->subject_id)->toBe($this->organiser->id);

        Sanctum::actingAs($this->organiser);
        $this->postJson('/api/v1/reports', ['target_type' => 'event', 'target_id' => $this->event->id, 'reason' => 'spam', 'details' => 'x'])->assertUnprocessable()->assertJsonPath('code', 'own_content');
        $draft = evEvent($this->organiser, ['status' => EventStatus::Draft]);
        Sanctum::actingAs($reporter);
        $this->postJson('/api/v1/reports', ['target_type' => 'event', 'target_id' => $draft->id, 'reason' => 'spam', 'details' => 'x'])->assertNotFound();
    });

    it('removes the event on a remove_content decision and brings it back on reversal', function () {
        $case = modCaseOf(modReport(User::factory()->create(), ReportTargetType::Event, $this->event->id, ReportReason::Illegal));
        $snapshot = app(ContentRestoration::class)->snapshot($case);

        app(ContentRemoval::class)->remove($case);
        expect($this->event->fresh()?->status)->toBe(EventStatus::Rejected)
            ->and($this->event->fresh()?->getAttribute('removed_at'))->not->toBeNull()
            ->and($snapshot)->toBe(['status' => 'published', 'removed' => false]);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertNotFound();
        expect(collect($this->getJson('/api/v1/events')->json('data'))->pluck('id'))->not->toContain($this->event->id);
    });
});

it('exports the events a member organised and their own answers, nobody else\'s', function () {
    $other = evEvent();
    evRsvp($other, $this->organiser, RsvpStatus::Interested);
    evRsvp($this->event, User::factory()->create(['username' => 'fremd.1']));
    $this->event->updates()->create(['author_id' => $this->organiser->id, 'body' => 'Tor 2 ist offen.']);

    $events = app(ExportContents::class)->documents($this->organiser)['events.json'];

    expect($events['organised'])->toHaveCount(1)
        ->and($events['organised'][0]['street'])->toBe('Am Sandtorkai 1')
        ->and($events['organised'][0]['updates'][0]['body'])->toBe('Tor 2 ist offen.')
        ->and($events['answers'])->toHaveCount(1)
        ->and($events['answers'][0]['status'])->toBe('interested')
        ->and(evStrings($events))->not->toContain('fremd.1');
});

describe('sample events (ShowcaseEvents)', function () {
    beforeEach(fn () => app()->detectEnvironment(fn () => 'staging'));

    // DQ-1112: the badge says "Beispiel"; titles, places and texts read like real meets. Covers: LaneBEventsTest (no photo folder here).
    it('seeds 8 dated sample events of the Editorial account, again in place, and rolls past ones forward', function () {
        $editorial = evOrganiser(['username' => 'speedclub.editorial', 'is_sample' => true, 'is_editorial' => true]);
        $demo = User::factory()->create(['username' => 'sebastian.demo', 'is_sample' => true]);
        $photos = sys_get_temp_dir().'/no-seed-photos';

        expect(app(ShowcaseEvents::class)->seed(photos: $photos))->toBe(8)
            ->and(app(ShowcaseEvents::class)->seed(photos: $photos))->toBe(8);
        $samples = Event::query()->where('is_sample', true)->get();

        expect($samples)->toHaveCount(8)
            ->and($samples->every(fn (Event $event): bool => $event->organiser_id === $editorial->id && $event->starts_at?->isFuture()))->toBeTrue()
            ->and(evStrings($samples->map(fn (Event $event): array => $event->only(['title', 'venue_name', 'street', 'description', 'organiser_rules']))->all()))->not->toContain('Beispiel')
            ->and($samples->where('location_visibility.value', 'after_rsvp'))->toHaveCount(1)
            ->and(EventRsvp::query()->where('user_id', $demo->id)->count())->toBe(3);

        $this->getJson('/api/v1/events?when=weekend')->assertOk();
        $this->travel(5)->weeks();
        expect(app(ShowcaseEvents::class)->roll())->toBeGreaterThan(0)
            ->and(Event::query()->where('is_sample', true)->where('ends_at', '<', now())->count())->toBe(0);
    });

    it('is removed by the purge with the answers to it', function () {
        evOrganiser(['username' => 'speedclub.editorial', 'is_sample' => true, 'is_editorial' => true]);
        app(ShowcaseEvents::class)->seed(photos: sys_get_temp_dir().'/no-seed-photos');
        evRsvp(Event::query()->where('is_sample', true)->firstOrFail(), User::factory()->create());

        expect(app(ShowcasePurge::class)->counts())->toMatchArray(['events' => 8, 'event_rsvps' => 1]);
        app(ShowcasePurge::class)->purge();
        expect(Event::query()->where('is_sample', true)->count())->toBe(0)
            ->and(Event::query()->find($this->event->id))->not->toBeNull();
    });
});

describe('GET geocode', function () {
    beforeEach(function () {
        config(['speedclub.geocode.contact_email' => 'kontakt@example.org']);
        Cache::flush();
        Http::preventStrayRequests();
    });

    it('searches through the server with a descriptive User-Agent, caches, and maps the parts', function () {
        Http::fake(['nominatim.openstreetmap.org/*' => Http::response([[
            'lat' => '53.5413', 'lon' => '9.9845', 'name' => 'Elbphilharmonie', 'display_name' => 'Elbphilharmonie, Platz der Deutschen Einheit 1, 20457 Hamburg',
            'address' => ['road' => 'Platz der Deutschen Einheit', 'house_number' => '1', 'postcode' => '20457', 'city' => 'Hamburg', 'country_code' => 'de'],
        ]])]);
        Sanctum::actingAs($this->organiser);

        $this->getJson('/api/v1/geocode?q='.urlencode('Elbphilharmonie Hamburg'))->assertOk()
            ->assertJsonPath('data.0.venue_name', 'Elbphilharmonie')
            ->assertJsonPath('data.0.street', 'Platz der Deutschen Einheit 1')
            ->assertJsonPath('data.0.city', 'Hamburg')
            ->assertJsonPath('data.0.country', 'DE')
            ->assertJsonPath('data.0.lat', 53.5413);
        $this->getJson('/api/v1/geocode?q='.urlencode('  elbphilharmonie   HAMBURG '))->assertOk();

        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $request): bool => str_starts_with($request->url(), 'https://nominatim.openstreetmap.org/search')
            && str_contains($request->header('User-Agent')[0] ?? '', 'kontakt@example.org')
            && $request['format'] === 'jsonv2');
    });

    it('needs a member, validates, is rate limited and says when the service is down', function () {
        $this->getJson('/api/v1/geocode?q=Hamburg')->assertUnauthorized();
        Sanctum::actingAs($this->organiser);
        $this->getJson('/api/v1/geocode?q=ab')->assertUnprocessable();

        Http::fake(['*' => Http::response('', 500)]);
        $this->getJson('/api/v1/geocode?q=Irgendwo')->assertStatus(503)->assertJsonPath('code', 'geocode_unavailable');

        // Three requests counted already; with a limit of one the next is refused before the upstream is asked.
        socLimit('geocode');
        $this->getJson('/api/v1/geocode?q=Bremen')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
        Http::assertSentCount(1);
    });
});
