<?php

use App\Actions\Events\DeleteEvent;
use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Enums\RsvpStatus;
use App\Enums\UserStatus;
use App\Models\Event;
use App\Models\User;
use App\Services\Moderation\ContentRemoval;
use App\Services\PublicPages\PartnerOgImages;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Support\Facades\Storage;

require_once dirname(__DIR__).'/Events/EventTestHelpers.php';

/**
 * M4.16 WEB-09 /e/{slug} (09 §9, EVT-02 as a public page): server-rendered without JavaScript, behind the flag `events`, always read as
 * a guest, so the exact place of an after_rsvp event never reaches the page, its JSON-LD, its OG tags or its card (09 §8.7, ADR-437 c).
 */
beforeEach(function () {
    Storage::fake('public');
    evFlags();
    $this->organiser = evOrganiser(['username' => 'nina.neu', 'display_name' => 'Nina Neu']);
    $this->event = evEvent($this->organiser, ['slug' => 'abendtreffen-am-hafen', 'title' => 'Abendtreffen am Hafen', 'capacity' => 40]);
});

it('renders the event page as a guest: date, place, rules, real counts, JSON-LD and the drawn card', function () {
    evRsvp($this->event, User::factory()->create());
    evRsvp($this->event, User::factory()->create(), RsvpStatus::Interested);

    $html = $this->get('/e/abendtreffen-am-hafen', ['Accept-Language' => 'de'])->assertOk()->assertSee('data-testid="WEB-09.root"', false)->getContent();

    expect($html)->toContain('Abendtreffen am Hafen')->toContain('Parkplatz am Hafen')->toContain('Am Sandtorkai 1, 20457 Hamburg')
        ->toMatch('/\d{2}:00–\d{2}:00 Uhr/u')->toContain('1 Zusage')->toContain('1 interessiert')->toContain('Noch 39 Plätze frei')
        ->toContain('Nur legal: keine Rennen')->toContain('href="'.url('/u/nina.neu').'"')
        ->toContain('"@type":"Event"')->toContain('"streetAddress":"Am Sandtorkai 1"')->toContain('EventScheduled')
        ->toContain('/og/e/abendtreffen-am-hafen-')->toContain('https://www.openstreetmap.org/directions?to=53.54130%2C9.98450')
        ->toContain('data-testid="WEB-09.calendar"')->toContain('/e/abendtreffen-am-hafen.ics')
        ->toContain('In der App zusagen')->toContain('/app/events/abendtreffen-am-hafen')
        ->not->toContain('noindex');
});

it('never shows the exact place of an after_rsvp event, not even to a going member with a token', function () {
    $event = evPrivateEvent($this->organiser, ['slug' => 'hof-treffen', 'venue_name' => 'Geheimer Hof', 'street' => 'Hinterweg 9', 'postcode' => '20099']);
    $member = User::factory()->create();
    evRsvp($event, $member);
    $token = $member->createToken('test')->plainTextToken;

    foreach ([[], ['Authorization' => 'Bearer '.$token]] as $headers) {
        $html = $this->get('/e/hof-treffen', $headers)->assertOk()->getContent();

        expect($html)->toContain('data-testid="WEB-09.afterRsvp"')->toContain('Hamburg')
            ->not->toContain('Geheimer Hof')->not->toContain('Hinterweg')->not->toContain('20099')
            ->not->toContain('53.5413')->not->toContain('streetAddress')->not->toContain('openstreetmap.org/directions');
    }
});

it('answers the same 404 page for every event a guest may not see', function (Closure $setup) {
    $setup($this->event, $this->organiser);

    $this->get('/e/abendtreffen-am-hafen')->assertNotFound()->assertSee('data-state="event_unavailable"', false)->assertSee('noindex', false);
})->with([
    'flag off' => [fn () => evFlags(['events' => false])],
    'draft' => [fn (Event $e) => $e->forceFill(['status' => EventStatus::Draft])->save()],
    'in review' => [fn (Event $e) => $e->forceFill(['status' => EventStatus::PendingReview])->save()],
    'rejected' => [fn (Event $e) => $e->forceFill(['status' => EventStatus::Rejected])->save()],
    'removed by staff' => [fn (Event $e) => $e->forceFill(['removed_at' => now()])->save()],
    'followers only' => [fn (Event $e) => $e->forceFill(['visibility' => EventVisibility::Followers])->save()],
    'organiser suspended' => [fn (Event $e, User $o) => $o->forceFill(['status' => UserStatus::Suspended])->save()],
    'sample while samples are hidden' => [function (Event $e) {
        $e->forceFill(['is_sample' => true])->save();
        evFlags(['editorial_samples' => false]);
    }],
    'missing' => [fn (Event $e) => $e->delete()],
]);

it('keeps the 404 for a followers-only event also for a follower with a token: the page is the same for everybody', function () {
    $this->event->forceFill(['visibility' => EventVisibility::Followers])->save();
    $member = User::factory()->create();
    evRsvp($this->event, $member);

    $this->get('/e/abendtreffen-am-hafen', ['Authorization' => 'Bearer '.$member->createToken('t')->plainTextToken])->assertNotFound();
});

it('shows a cancelled event with its reason and without the RSVP and calendar actions', function () {
    $this->event->forceFill(['status' => EventStatus::Cancelled, 'cancelled_at' => now(), 'cancellation_reason' => 'Sturmwarnung für Hamburg.'])->save();

    $html = $this->get('/e/abendtreffen-am-hafen')->assertOk()->getContent();
    expect($html)->toContain('data-state="cancelled"')->toContain('Sturmwarnung für Hamburg.')->toContain('EventCancelled')
        ->not->toContain('data-testid="WEB-09.calendar"')->not->toContain('In der App zusagen');
});

it('marks a past event and a sample, which is noindex and shows no counts', function () {
    $this->event->forceFill(['starts_at' => now()->subDays(3), 'ends_at' => now()->subDays(3)->addHours(2)])->save();
    $this->get('/e/abendtreffen-am-hafen')->assertOk()->assertSee('data-testid="WEB-09.past"', false)->assertDontSee('data-testid="WEB-09.calendar"', false);

    $this->event->forceFill(['is_sample' => true, 'starts_at' => now()->addDay(), 'ends_at' => now()->addDay()->addHours(2)])->save();
    $html = $this->get('/e/abendtreffen-am-hafen')->assertOk()->getContent();
    expect($html)->toContain('noindex')->toContain('data-testid="WEB-09.sampleNote"')->toContain('data-testid="WEB-09.countsHidden"')
        ->not->toContain('data-testid="WEB-09.counts"');
});

it('is noindex while unlisted or while the organiser keeps search engines out', function () {
    $this->event->forceFill(['visibility' => EventVisibility::Unlisted])->save();
    $this->get('/e/abendtreffen-am-hafen')->assertOk()->assertSee('<meta name="robots" content="noindex">', false);

    $this->event->forceFill(['visibility' => EventVisibility::Public])->save();
    $this->organiser->forceFill(['indexable' => false])->save();
    $this->get('/e/abendtreffen-am-hafen')->assertOk()->assertSee('<meta name="robots" content="noindex">', false);
});

it('speaks English and redirects a slug in other case to the canonical one', function () {
    $this->get('/e/abendtreffen-am-hafen?lang=en')->assertOk()->assertSee('RSVP in the app')->assertSee('Who is coming');
    $this->get('/e/Abendtreffen-Am-Hafen')->assertRedirect('/e/abendtreffen-am-hafen')->assertStatus(301);
});

it('keeps the calendar file on its own route beside the page', function () {
    $this->get('/e/abendtreffen-am-hafen.ics')->assertOk()->assertHeader('Content-Type', 'text/calendar; charset=utf-8');
});

it('serves the event card as a JPEG in both formats, and nothing for an event a guest may not see', function () {
    $html = $this->get('/e/abendtreffen-am-hafen')->getContent();
    preg_match('#/og/e/(abendtreffen-am-hafen-[0-9a-f]{16})\.jpg#', $html, $match);
    expect($match)->not->toBeEmpty();

    $landscape = $this->get('/og/e/'.$match[1].'.jpg')->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    expect(getimagesizefromstring((string) $landscape->getContent())[0])->toBe(1200)
        ->and($landscape->headers->get('Cache-Control'))->toContain('immutable');
    $square = $this->get('/og/e/'.$match[1].'-square.jpg')->assertOk();
    expect(getimagesizefromstring((string) $square->getContent())[1])->toBe(1080);

    // A stale hash gets today's card for an hour; an event that left the public has no card.
    expect($this->get('/og/e/abendtreffen-am-hafen-0000000000000000.jpg')->assertOk()->headers->get('Cache-Control'))->not->toContain('immutable');
    $this->event->forceFill(['visibility' => EventVisibility::Followers])->save();
    $this->get('/og/e/'.$match[1].'.jpg')->assertNotFound();
});

it('draws no venue of an after_rsvp event on its card: the spec holds the city only', function () {
    $event = evPrivateEvent($this->organiser, ['venue_name' => 'Geheimer Hof', 'street' => 'Hinterweg 9']);

    $spec = app(PartnerOgImages::class)->spec($event);
    expect(json_encode($spec))->toContain('Hamburg')->not->toContain('Geheimer Hof')->not->toContain('Hinterweg');
});

it('lists public events in the sitemap while the flag is on: no samples, followers-only, unlisted or old ones', function () {
    evEvent($this->organiser, ['slug' => 'nur-follower', 'visibility' => EventVisibility::Followers]);
    evEvent($this->organiser, ['slug' => 'nicht-gelistet', 'visibility' => EventVisibility::Unlisted]);
    evEvent($this->organiser, ['slug' => 'beispiel-treffen', 'is_sample' => true]);
    evEvent($this->organiser, ['slug' => 'lange-her', 'starts_at' => now()->subDays(60), 'ends_at' => now()->subDays(60)->addHours(2)]);

    $xml = app(SitemapWriter::class)->render();
    expect($xml)->toContain('/e/abendtreffen-am-hafen')->not->toContain('nur-follower')->not->toContain('nicht-gelistet')
        ->not->toContain('beispiel-treffen')->not->toContain('lange-her');

    evFlags(['events' => false]);
    expect(app(SitemapWriter::class)->render())->not->toContain('/e/abendtreffen-am-hafen');
});

it('claims /e/ for the app while events are on, and lets crawlers and link previews read /e/, /b/ and /brands/', function () {
    config(['speedclub.mobile.ios_team_id' => 'ABCDE12345', 'speedclub.mobile.ios_bundle_id' => 'de.speedclub.app', 'speedclub.public_pages.allow_indexing' => true]);

    $paths = collect($this->get('/.well-known/apple-app-site-association')->json('applinks.details.0.components'))->pluck('/')->all();
    expect($paths)->toContain('/e/*');

    $robots = (string) $this->get('/robots.txt')->getContent();
    expect($robots)->toContain('Allow: /e/')->toContain('Allow: /b/')->toContain('Allow: /brands/');

    evFlags(['events' => false]);
    $paths = collect($this->get('/.well-known/apple-app-site-association')->json('applinks.details.0.components'))->pluck('/')->all();
    expect($paths)->not->toContain('/e/*');
});

it('drops the written sitemap at once when a public event is deleted or removed by staff', function () {
    Storage::fake('local');
    $sitemap = app(SitemapWriter::class);
    $path = config()->string('speedclub.public_pages.sitemap_path');

    $sitemap->write();
    Storage::disk('local')->assertExists($path);
    app(DeleteEvent::class)->handle($this->event);
    Storage::disk('local')->assertMissing($path);

    $other = evEvent($this->organiser);
    $sitemap->write();
    foreach ((fn () => $this->event($other))->call(app(ContentRemoval::class)) as $work) {
        $work();
    }
    Storage::disk('local')->assertMissing($path);
});
