<?php

use App\Enums\GalleryPhotoSource;
use App\Enums\GalleryPhotoStatus;
use App\Enums\MediaCategory;
use App\Enums\PlateBlurState;
use App\Enums\RsvpStatus;
use App\Models\EventPhoto;
use App\Models\Media;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/M56TestHelpers.php';

/**
 * M5.6 post-event gallery endpoints (m5.6-contract §4.2–§4.4): multipart upload through the media pipeline with the plate blur step,
 * statuses (organiser approved, attendee pending), limits, window, idempotency, lists and the detail fields.
 */
beforeEach(function () {
    m56Flags();
    m56Disks();
    $this->organiser = evOrganiser(['username' => 'jann.ptrs']);
    $this->event = m56JustEnded($this->organiser);
    $this->going = User::factory()->create(['username' => 'mia.k']);
    evRsvp($this->event, $this->going);
});

describe('POST events/{slug}/gallery', function () {
    it('publishes the organiser\'s photo at once, through the media pipeline', function () {
        Sanctum::actingAs($this->organiser);

        $response = $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(extra: ['alt' => 'Reihe am Hafen']))->assertCreated()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.source', 'organiser')
            ->assertJsonPath('data.uploader.username', 'jann.ptrs')
            ->assertJsonPath('data.can.delete', true)
            ->assertJsonPath('data.can.report', false);

        $photo = EventPhoto::query()->sole();
        $media = Media::query()->findOrFail($photo->media_id);
        expect($response->json('data.media.id'))->toBe($media->id)
            ->and($media->category)->toBe(MediaCategory::Event)
            ->and($media->getAttribute('mediable_type'))->toBe('event_photo')
            ->and($media->getAttribute('mediable_id'))->toBe($photo->id)
            ->and($media->owner_id)->toBe($this->organiser->id)
            ->and($media->alt)->toBe('Reihe am Hafen')
            ->and($media->plate_blur)->toBe(PlateBlurState::Declined)
            ->and($photo->sort)->toBe(1)
            ->and($photo->reviewed_at)->not->toBeNull()
            ->and(count($response->json('data.media.variants')))->toBeGreaterThan(0);
    });

    it('keeps an attendee\'s photo pending until the organiser decides', function () {
        Sanctum::actingAs($this->going);

        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.source', 'attendee')
            ->assertJsonPath('data.can.delete', true)
            ->assertJsonPath('data.can.moderate', false);

        expect(EventPhoto::query()->sole()->status)->toBe(GalleryPhotoStatus::Pending);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.gallery.count', 0)->assertJsonPath('data.gallery.mine_pending', 1);
    });

    it('pixelates the plate into the master before any public file, with plate_blur=1', function () {
        Sanctum::actingAs($this->going);
        $regions = [['x' => 0.35, 'y' => 0.7, 'w' => 0.3, 'h' => 0.1]];

        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload($regions))->assertCreated();

        $media = Media::query()->findOrFail(EventPhoto::query()->sole()->media_id);
        expect($media->plate_blur)->toBe(PlateBlurState::Blurred)
            ->and($media->blur_regions)->toBeNull();
    });

    it('needs the plate decision and a valid region list', function () {
        Sanctum::actingAs($this->going);

        $this->post("/api/v1/events/{$this->event->slug}/gallery", ['file' => m56Photo()], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('plate_blur');
        $this->post("/api/v1/events/{$this->event->slug}/gallery", ['file' => m56Photo(), 'plate_blur' => '1'], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('blur_regions');
        $this->post("/api/v1/events/{$this->event->slug}/gallery", ['plate_blur' => '0'], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('file');
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(extra: ['alt' => str_repeat('a', 201)]), ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('alt');
        expect(EventPhoto::query()->count())->toBe(0);
    });

    it('refuses a photo whose shorter side is below 800 px', function () {
        Sanctum::actingAs($this->going);

        $this->post("/api/v1/events/{$this->event->slug}/gallery", [...m56Upload(), 'file' => m56Photo(1200, 700)], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors('file');
        expect(EventPhoto::query()->count())->toBe(0)->and(Media::query()->count())->toBe(0);
    });

    it('accepts uploads from the end until 14 days after it, and says when otherwise', function () {
        Sanctum::actingAs($this->going);
        $upcoming = evEvent($this->organiser, ['starts_at' => now()->addDay(), 'ends_at' => now()->addDay()->addHours(3)]);
        evRsvp($upcoming, $this->going);
        $running = evEvent($this->organiser, ['starts_at' => now()->subHour(), 'ends_at' => now()->addHours(2)]);
        evRsvp($running, $this->going);
        $old = m56JustEnded($this->organiser, ['starts_at' => now()->subDays(16), 'ends_at' => now()->subDays(15)]);
        evRsvp($old, $this->going);

        $this->post("/api/v1/events/{$upcoming->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertForbidden()
            ->assertJsonPath('code', 'gallery_closed')
            ->assertJsonPath('meta.opens_at', $upcoming->ends_at?->toIso8601String());
        // Nothing live (ADR-525): during the meet the gallery is still closed, also for the organiser.
        $this->post("/api/v1/events/{$running->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertForbidden()
            ->assertJsonPath('code', 'gallery_closed')
            ->assertJsonPath('meta.opens_at', $running->ends_at?->toIso8601String());
        Sanctum::actingAs($this->organiser);
        $this->post("/api/v1/events/{$running->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertForbidden()
            ->assertJsonPath('code', 'gallery_closed');
        $this->travelTo($running->ends_at?->addMinute());
        $this->post("/api/v1/events/{$running->slug}/gallery", m56Upload())->assertCreated();
        $this->travelBack();
        Sanctum::actingAs($this->going);
        $this->post("/api/v1/events/{$old->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertForbidden()
            ->assertJsonPath('code', 'gallery_closed')
            ->assertJsonPath('meta.closes_at', $old->ends_at?->addDays(14)->toIso8601String());

        $this->travelTo($this->event->ends_at?->addDays(14)->subMinute());
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
    });

    it('takes the start plus six hours as the end of an event without one', function () {
        $open = evEvent($this->organiser, ['starts_at' => now()->subDays(14)->subHours(5), 'ends_at' => null]);
        Sanctum::actingAs($this->organiser);

        $this->getJson("/api/v1/events/{$open->slug}")->assertJsonPath('data.gallery.open', true)
            ->assertJsonPath('data.gallery.closes_at', $open->starts_at?->addHours(6)->addDays(14)->toIso8601String());
    });

    it('is closed for cancelled and sample events', function () {
        $cancelled = m56JustEnded($this->organiser, ['status' => 'cancelled', 'cancelled_at' => now()->subHours(3)]);
        evRsvp($cancelled, $this->going);
        $sample = m56JustEnded($this->organiser, ['is_sample' => true]);
        Sanctum::actingAs($this->organiser);

        $this->getJson("/api/v1/events/{$cancelled->slug}")->assertJsonPath('data.gallery.open', false)->assertJsonPath('data.can.add_photos', false);
        $this->getJson("/api/v1/events/{$sample->slug}")->assertJsonPath('data.gallery.open', false)->assertJsonPath('data.can.add_photos', false);
        $this->post("/api/v1/events/{$sample->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertForbidden()->assertJsonPath('code', 'gallery_closed');
    });

    it('lets a member who checked in without an RSVP add photos', function () {
        $walkIn = User::factory()->create();
        m56Checkin($this->event, $walkIn);
        Sanctum::actingAs($walkIn);

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.can.add_photos', true);
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated()->assertJsonPath('data.status', 'pending');
    });

    it('holds 10 photos per attendee (pending and rejected included), 40 for the organiser and 200 per event', function () {
        config(['speedclub.events.gallery_limits' => ['attendee' => 2, 'organiser' => 1, 'event' => 3]]);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Pending);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Rejected);
        Sanctum::actingAs($this->going);

        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409)->assertJsonPath('code', 'limit_reached');

        // One the uploader deleted still counts against their own limit (SEC-P5-12: delete and upload again would refill it without end) …
        EventPhoto::query()->where('status', GalleryPhotoStatus::Rejected->value)->sole()->delete();
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409)->assertJsonPath('code', 'limit_reached');

        // … one staff removed does not.
        EventPhoto::query()->where('uploader_id', $this->going->id)->where('status', GalleryPhotoStatus::Pending->value)->sole()
            ->forceFill(['status' => GalleryPhotoStatus::Removed])->save();
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();

        // A third attendee's approved photo (the event limit counts what is there: 3 with the organiser's below).
        m56GalleryPhoto($this->event, User::factory()->create(), GalleryPhotoStatus::Approved);

        Sanctum::actingAs($this->organiser);
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409)
            ->assertJsonPath('code', 'limit_reached')->assertJsonPath('message', __('events.gallery_limit_own', ['max' => 1]));

        // The event is full (3), whoever asks.
        $another = User::factory()->create();
        evRsvp($this->event, $another);
        Sanctum::actingAs($another);
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409)
            ->assertJsonPath('message', __('events.gallery_limit_event', ['max' => 3]));
    });

    it('answers a repeated Idempotency-Key with the first photo', function () {
        Sanctum::actingAs($this->going);
        $headers = ['Idempotency-Key' => 'gal-0001-aaaa-bbbb', 'Accept' => 'application/json'];
        $body = m56Upload();

        $first = $this->post("/api/v1/events/{$this->event->slug}/gallery", $body, $headers)->assertCreated()->json('data.id');
        $second = $this->post("/api/v1/events/{$this->event->slug}/gallery", $body, $headers)->assertCreated()->assertHeader('Idempotency-Replayed', 'true')->json('data.id');

        expect($second)->toBe($first)->and(EventPhoto::query()->count())->toBe(1);
    });

    it('is limited by throttle:uploads', function () {
        socLimit('uploads');
        Sanctum::actingAs($this->going);

        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload())->assertCreated();
        $this->post("/api/v1/events/{$this->event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(429)->assertHeader('Retry-After');
    });
});

describe('GET events/{slug}/gallery', function () {
    it('lists approved photos in approval order with a cursor, for guests too', function () {
        $first = m56GalleryPhoto($this->event, $this->going);
        $second = m56GalleryPhoto($this->event, $this->organiser, attributes: ['source' => GalleryPhotoSource::Organiser]);
        $third = m56GalleryPhoto($this->event, $this->going);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Pending);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Rejected);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Removed);

        $page = $this->getJson("/api/v1/events/{$this->event->slug}/gallery?per_page=2")->assertOk()
            ->assertJsonPath('data.0.id', $first->id)
            ->assertJsonPath('data.1.id', $second->id)
            ->assertJsonPath('data.0.reject_reason', null)
            ->assertJsonPath('data.0.can.report', false)
            ->assertJsonPath('meta.per_page', 2);
        $next = $page->json('meta.next_cursor');

        $this->getJson("/api/v1/events/{$this->event->slug}/gallery?per_page=2&cursor=$next")->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $third->id)->assertJsonPath('meta.next_cursor', null);
    });

    it('shows the organiser the queue, oldest first, and the uploader their own photos in every status', function () {
        $older = m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Pending, ['created_at' => now()->subMinutes(10)]);
        $newer = m56GalleryPhoto($this->event, User::factory()->create(), GalleryPhotoStatus::Pending);
        $rejected = m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Rejected, ['reject_reason' => 'Unscharf']);
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Removed);

        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=pending")->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.id', $older->id)->assertJsonPath('data.1.id', $newer->id)
            ->assertJsonPath('data.0.status', 'pending')->assertJsonPath('data.0.can.moderate', true);

        Sanctum::actingAs($this->going);
        $mine = $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=mine")->assertOk()->assertJsonCount(2, 'data');
        expect(array_column($mine->json('data'), 'id'))->toBe([$older->id, $rejected->id])
            ->and($mine->json('data.1.reject_reason'))->toBe('Unscharf')
            ->and($mine->json('data.1.status'))->toBe('rejected');
    });

    it('refuses a cursor of the other order and a page above 50', function () {
        m56GalleryPhoto($this->event, $this->going);
        m56GalleryPhoto($this->event, $this->going);
        $cursor = $this->getJson("/api/v1/events/{$this->event->slug}/gallery?per_page=1")->json('meta.next_cursor');
        Sanctum::actingAs($this->going);

        $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=mine&cursor=$cursor")->assertUnprocessable()->assertJsonValidationErrors('cursor');
        $this->getJson("/api/v1/events/{$this->event->slug}/gallery?per_page=51")->assertUnprocessable()->assertJsonValidationErrors('per_page');
        $this->getJson("/api/v1/events/{$this->event->slug}/gallery?status=everything")->assertUnprocessable()->assertJsonValidationErrors('status');
    });

    it('leaves out photos of members with a block either way', function () {
        $blocked = User::factory()->create();
        $blocker = User::factory()->create();
        $photo = m56GalleryPhoto($this->event, $blocked);
        m56GalleryPhoto($this->event, $blocker);
        socBlock($this->going, $blocked);
        socBlock($blocker, $this->going);
        Sanctum::actingAs($this->going);

        $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.gallery.count', 0);

        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertJsonCount(2, 'data')->assertJsonPath('data.0.id', $photo->id);
    });

    it('sends an ETag and answers 304 to it', function () {
        m56GalleryPhoto($this->event, $this->going);
        $etag = $this->getJson("/api/v1/events/{$this->event->slug}/gallery")->assertOk()->headers->get('ETag');

        expect($etag)->not->toBeNull();
        $this->getJson("/api/v1/events/{$this->event->slug}/gallery", ['If-None-Match' => (string) $etag])->assertStatus(304);
    });
});

describe('EventResource.gallery', function () {
    it('carries the window, counts and the six newest approvals', function () {
        foreach (range(1, 7) as $i) {
            m56GalleryPhoto($this->event, $this->going);
        }
        $newest = EventPhoto::query()->orderByDesc('sort')->first();
        m56GalleryPhoto($this->event, $this->going, GalleryPhotoStatus::Pending);
        m56GalleryPhoto($this->event, User::factory()->create(), GalleryPhotoStatus::Pending);

        Sanctum::actingAs($this->organiser);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
            ->assertJsonPath('data.gallery.open', true)
            ->assertJsonPath('data.gallery.opens_at', $this->event->ends_at?->toIso8601String())
            ->assertJsonPath('data.gallery.closes_at', $this->event->ends_at?->addDays(14)->toIso8601String())
            ->assertJsonPath('data.gallery.count', 7)
            ->assertJsonPath('data.gallery.pending', 2)
            ->assertJsonPath('data.gallery.mine_pending', 0)
            ->assertJsonCount(6, 'data.gallery.preview')
            ->assertJsonPath('data.gallery.preview.0.id', $newest?->id)
            ->assertJsonPath('data.can.moderate_photos', true)
            ->assertJsonPath('data.can.add_photos', true);

        Sanctum::actingAs($this->going);
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.gallery.pending', null)
            ->assertJsonPath('data.gallery.mine_pending', 1)->assertJsonPath('data.can.moderate_photos', false);
    });

    it('says null for the pending counts of a guest, and no add_photos', function () {
        $this->getJson("/api/v1/events/{$this->event->slug}")->assertOk()
            ->assertJsonPath('data.gallery.pending', null)
            ->assertJsonPath('data.gallery.mine_pending', null)
            ->assertJsonPath('data.can.add_photos', false);
    });

    it('offers add_photos to going members only, not to interested ones', function () {
        $interested = User::factory()->create();
        evRsvp($this->event, $interested, RsvpStatus::Interested);
        Sanctum::actingAs($interested);

        $this->getJson("/api/v1/events/{$this->event->slug}")->assertJsonPath('data.can.add_photos', false);
    });
});
