<?php

use App\Enums\EventStatus;
use App\Enums\RestrictionType;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\EventUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\Search\VehicleSearchProjector;
use App\Services\Showcase\ShowcaseEvents;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/EventTestHelpers.php';
require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * Phase 4 lane B events follow-ups (DQ-1110, DQ-1111, DQ-1112): the EventCard's attendee preview, the organiser's review flags, text
 * search, removing the cover, and the seeds of design QA.
 */
beforeEach(function () {
    evFlags();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->event = evEvent($this->organiser);
});

describe('attendee preview', function () {
    it('shows up to three going members by username to members, by EVT-04\'s rules', function () {
        foreach (['dora', 'anna', 'carl', 'bert'] as $name) {
            evRsvp($this->event, User::factory()->create(['username' => $name]));
        }
        evRsvp($this->event, User::factory()->create(['username' => 'aaron']), RsvpStatus::Interested);
        evRsvp($this->event, User::factory()->create(['username' => 'abel', 'discoverable' => false]));
        $blocked = User::factory()->create(['username' => 'aal']);
        evRsvp($this->event, $blocked);
        $viewer = User::factory()->create();
        socBlock($viewer, $blocked);
        Sanctum::actingAs($viewer);

        $this->getJson('/api/v1/events')->assertOk()
            ->assertJsonPath('data.0.attendee_preview.*.username', ['anna', 'bert', 'carl'])
            ->assertJsonPath('data.0.counts.going', 6);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()->assertJsonCount(3, 'data.attendee_preview');
    });

    it('is empty for guests and on sample events', function () {
        evRsvp($this->event, User::factory()->create());
        $this->getJson('/api/v1/events')->assertOk()->assertJsonPath('data.0.attendee_preview', []);

        $editorial = evOrganiser(['username' => 'speedclub.editorial', 'is_sample' => true]);
        $sample = evEvent($editorial, ['is_sample' => true]);
        evRsvp($sample, User::factory()->create());
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$sample->slug}")->assertOk()->assertJsonPath('data.attendee_preview', []);
    });
});

describe('organiser chip', function () {
    it('carries the cover of the organiser\'s main build, when the reader may see it, and verified false', function () {
        $main = publishedVehicle($this->organiser, ['is_main' => true]);
        app(VehicleSearchProjector::class)->rebuild($main->id);

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
            ->assertJsonPath('data.organiser.username', 'jann.ptrs')
            ->assertJsonPath('data.organiser.verified', false)
            ->assertJsonPath('data.organiser.main_vehicle_cover.id', fn (?string $id): bool => is_string($id));

        $main->forceFill(['visibility' => 'private'])->save();
        app(VehicleSearchProjector::class)->rebuild($main->id);
        $this->getJson('/api/v1/events')->assertOk()->assertJsonPath('data.0.organiser.main_vehicle_cover', null);
    });
});

describe('organiser review flags', function () {
    it('says before sending whether the team reviews it, and after publishing whether it did', function () {
        $draft = evEvent($this->organiser, ['status' => EventStatus::Draft]);
        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$draft->slug}")->assertOk()
            ->assertJsonPath('data.review.will_be_reviewed', true)
            ->assertJsonPath('data.review.was_premoderated', false);

        // Two approved events later, a public one goes live at once.
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        $this->getJson("/api/v1/events/{$draft->slug}")->assertJsonPath('data.review.will_be_reviewed', false);
        $private = evPrivateEvent($this->organiser, ['status' => EventStatus::Draft]);
        $this->getJson("/api/v1/events/{$private->slug}")->assertJsonPath('data.review.will_be_reviewed', true);

        $approved = evEvent($this->organiser, ['reviewed_at' => now()->subDay()]);
        $this->getJson("/api/v1/events/{$approved->slug}")->assertJsonPath('data.review.was_premoderated', true)->assertJsonPath('data.review.will_be_reviewed', false);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.review.was_premoderated', false);

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$approved->slug}")->assertJsonPath('data.review', null);
    });
});

describe('GET events?q=', function () {
    it('finds every word in the title or the city, never in the place', function () {
        $coffee = evEvent(attributes: ['title' => 'Cars & Coffee Altstadt', 'city' => 'Köln']);
        evEvent(attributes: ['title' => 'Ausfahrt zur Seenplatte', 'city' => 'Berlin']);
        evPrivateEvent(attributes: ['title' => 'Abendtreffen', 'city' => 'München', 'venue_name' => 'Geheimhof Kaffeerösterei']);

        $this->getJson('/api/v1/events?q=coffee+köln')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $coffee->id);
        $this->getJson('/api/v1/events?q=berlin')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/events?q=Geheimhof')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/events?q=100%25')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/events?q='.str_repeat('a', 81))->assertUnprocessable()->assertJsonValidationErrors('q');
    });
});

describe('DELETE events/{slug}/cover', function () {
    beforeEach(function () {
        Storage::fake('public');
        Storage::fake('local');
        config(['speedclub.media.disk' => 'public']);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        evEvent($this->organiser, ['published_at' => now()->subMonth()]);
        Sanctum::actingAs($this->organiser);
        $this->cover = $this->post("/api/v1/events/{$this->event->slug}/cover", ['file' => UploadedFile::fake()->image('a.jpg', 1600, 900)])->assertCreated()->json('data.id');
    });

    it('takes the cover off and deletes the photo, and answers the same again', function () {
        $this->deleteJson("/api/v1/events/{$this->event->slug}/cover")->assertOk()
            ->assertJsonPath('data.cover', null)
            ->assertJsonPath('data.status', 'published');

        expect(Media::query()->find($this->cover))->toBeNull()
            ->and($this->event->fresh()?->getAttribute('cover_media_id'))->toBeNull();
        $this->deleteJson("/api/v1/events/{$this->event->slug}/cover")->assertOk();
    });

    it('is closed while the event is in review or over', function (array $state, string $code) {
        $this->event->forceFill($state)->save();

        $this->deleteJson("/api/v1/events/{$this->event->slug}/cover")->assertStatus(409)->assertJsonPath('code', $code);
        expect(Media::query()->find($this->cover))->not->toBeNull();
    })->with([
        'in review' => [['status' => EventStatus::PendingReview], 'event_in_review'],
        'over' => [['starts_at' => now()->subDays(2), 'ends_at' => now()->subDay()], 'event_closed'],
    ]);

    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        // The organiser of beforeEach signed out first, so the guest row is a guest.
        auth()->forgetGuards();
        socActAs($who($this->organiser));

        $response = $this->deleteJson("/api/v1/events/{$this->event->slug}/cover")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }

        expect(Media::query()->find($this->cover))->not->toBeNull();
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [403, 'forbidden'],
        'unverified member' => [403, 'forbidden'],
        'member restricted from publishing' => [403, 'forbidden'],
        'member restricted from messaging' => [403, 'forbidden'],
        'suspended member' => [403, 'forbidden'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'event_unavailable'],
        'member the other blocked' => [404, 'event_unavailable'],
    ]));

    it('stays open to the organiser under a publishing restriction', function () {
        $this->organiser->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

        $this->deleteJson("/api/v1/events/{$this->event->slug}/cover")->assertOk()->assertJsonPath('data.cover', null);
    });
});

describe('design-QA seeds (ShowcaseEvents)', function () {
    beforeEach(function () {
        app()->detectEnvironment(fn () => 'staging');
        Storage::fake('public');
        Storage::fake('local');
        config(['speedclub.media.disk' => 'public']);
        $this->photos = sys_get_temp_dir().'/seed-photos-'.bin2hex(random_bytes(4));
        File::ensureDirectoryExists($this->photos.'/processed');
        // Only the graded renditions count; the raw file of the second cover alone gives no cover.
        file_put_contents($this->photos.'/processed/nissan-s14-03-2048.jpg', TestImages::jpeg(1600, 1067));
        file_put_contents($this->photos.'/processed/nissan-z33-05-2048.jpg', TestImages::jpeg(1600, 2133));
        file_put_contents($this->photos.'/toyota-a90-04.jpg', TestImages::jpeg(1600, 1067));
        file_put_contents($this->photos.'/manifest.json', json_encode([
            ['file' => 'nissan-s14-03.jpg', 'alt_de' => 'Dunkelgrauer Nissan Silvia S14 Driftprojekt ohne Frontschürze am Hafen vor einer Fähre', 'focal' => ['x' => 0.5, 'y' => 0.6]],
        ]));
        $this->editorial = evOrganiser(['username' => 'speedclub.editorial', 'is_sample' => true, 'is_editorial' => true]);
    });

    afterEach(fn () => File::deleteDirectory($this->photos));

    it('gives sample events their own graded cover once, and drops sample events no longer in the data', function () {
        $stale = evEvent($this->editorial, ['is_sample' => true, 'slug' => 'beispiel-treffen-hafen-klahfh', 'title' => 'Beispiel-Treffen Hafen']);

        app(ShowcaseEvents::class)->seed(photos: $this->photos);
        $hafen = Event::query()->where('slug', 'abendtreffen-am-hafen-klahfh')->firstOrFail();
        $cover = Media::query()->findOrFail($hafen->getAttribute('cover_media_id'));

        expect($cover->getAttribute('sample_source'))->toBe('event-cover:nissan-s14-03.jpg')
            ->and($cover->getAttribute('alt'))->toBe('Dunkelgrauer Nissan Silvia S14 Driftprojekt ohne Frontschürze am Hafen vor einer Fähre')
            ->and(Event::query()->where('slug', 'cars-coffee-altstadt-urtgii')->value('cover_media_id'))->toBeNull()
            ->and(Event::query()->find($stale->id))->toBeNull();

        // One import per event with a graded photo (the Abendtreffen and jann.ptrs's demo meet), none again on a second run.
        expect(Media::query()->where('sample_source', 'like', 'event-cover:%')->count())->toBe(2);
        app(ShowcaseEvents::class)->seed(photos: $this->photos);
        expect($hafen->fresh()?->getAttribute('cover_media_id'))->toBe($cover->id)
            ->and(Media::query()->where('sample_source', 'like', 'event-cover:%')->count())->toBe(2);
    });

    it('seeds the answerable demo meet with going and interested members, an update, the exact place, and one that is over', function () {
        $usernames = ['lukas.sc', 'max.e46', 'sara.gti', 'kenji.r34', 'tobi.quattro', 'lena.911', 'marco.amg', 'finn.jdm', 'aylin.vtec', 'nico.sti', 'paul.roadster'];

        foreach ($usernames as $username) {
            User::factory()->create(['username' => $username]);
        }

        app(ShowcaseEvents::class)->seed(photos: $this->photos);
        app(ShowcaseEvents::class)->seed(photos: $this->photos);
        $meet = Event::query()->where('slug', 'feierabendtreffen-am-elbdeich-jlfgqt')->firstOrFail();

        expect($meet->is_sample)->toBeFalse()
            ->and($meet->organiser_id)->toBe($this->organiser->id)
            ->and($meet->starts_at?->isFuture())->toBeTrue()
            ->and($meet->getAttribute('cover_media_id'))->not->toBeNull()
            ->and(EventRsvp::query()->where('event_id', $meet->id)->where('status', RsvpStatus::Going)->count())->toBe(8)
            ->and(EventRsvp::query()->where('event_id', $meet->id)->where('status', RsvpStatus::Interested)->count())->toBe(3)
            ->and(EventUpdate::query()->where('event_id', $meet->id)->count())->toBe(1);

        // A member who has not answered: the main state of EVT-02, independent of editorial_samples.
        evFlags(['editorial_samples' => false]);
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/events/{$meet->slug}")->assertOk()
            ->assertJsonPath('data.can.rsvp', true)
            ->assertJsonPath('data.my_rsvp', null)
            ->assertJsonPath('data.location.exact', true)
            ->assertJsonPath('data.counts', ['going' => 8, 'interested' => 3])
            ->assertJsonCount(3, 'data.attendee_preview');

        $past = Event::query()->where('slug', 'saugmotor-abend-pkvmaw')->firstOrFail();
        expect($past->hasEnded())->toBeTrue();

        // The upcoming meet rolls forward with the samples; the past one stays past.
        $this->travel(3)->weeks();
        app(ShowcaseEvents::class)->roll();
        expect($meet->fresh()?->starts_at?->isFuture())->toBeTrue()
            ->and($past->fresh()?->starts_at?->equalTo($past->starts_at))->toBeTrue();
    });

    it('skips the demo meets where the demo members are missing', function () {
        $this->organiser->forceFill(['username' => 'jann.other'])->save();

        app(ShowcaseEvents::class)->seed(photos: $this->photos);

        expect(Event::query()->where('slug', 'feierabendtreffen-am-elbdeich-jlfgqt')->exists())->toBeFalse();
    });
});
