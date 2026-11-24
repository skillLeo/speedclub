<?php

use App\Enums\GalleryPhotoStatus;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\Media;
use App\Models\User;
use App\Services\Showcase\ShowcaseEvents;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\Support\TestImages;

/**
 * DQ-P5-012 (design QA P5 r1): the past demo meet (Saugmotor-Abend) carries an approved gallery of its organiser and attendees, each a
 * graded seed photo no event uses as its cover, is_sample, imported once; more than the detail's preview holds, so "Alle Fotos" shows
 * (EVT-02-gallery-all), plus two pending photos for the organiser's queue (M5.10); a second run changes nothing.
 */
beforeEach(function () {
    app()->detectEnvironment(fn () => 'staging');
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public']);
    $this->photos = sys_get_temp_dir().'/seed-photos-'.bin2hex(random_bytes(4));
    File::ensureDirectoryExists($this->photos.'/processed');
    $data = json_decode((string) file_get_contents(database_path('data/showcase/events.json')), true);
    $this->gallery = collect($data['member_events'])->firstWhere('key', 'saugmotor')['gallery'];
    $this->covers = collect([...$data['events'], ...$data['member_events']])->pluck('cover')->filter()->all();

    foreach ($this->gallery as $row) {
        file_put_contents($this->photos.'/processed/'.substr($row['photo'], 0, -4).'-2048.jpg', TestImages::jpeg(1600, 1067));
    }

    file_put_contents($this->photos.'/manifest.json', json_encode(array_map(fn (array $row): array => ['file' => $row['photo'], 'alt_de' => 'Nachtfoto vom Treffen', 'focal' => ['x' => 0.5, 'y' => 0.5]], $this->gallery)));
    User::factory()->create(['username' => 'speedclub.editorial', 'is_sample' => true, 'is_editorial' => true]);

    foreach (['max.e46', 'lukas.sc', 'sara.gti', 'lena.911', 'finn.jdm', 'tobi.quattro'] as $username) {
        User::factory()->create(['username' => $username]);
    }
});

afterEach(fn () => File::deleteDirectory($this->photos));

it('seeds the past demo meet\'s gallery with distinct, non-cover photos, once', function () {
    app(ShowcaseEvents::class)->seed(photos: $this->photos);
    $meet = Event::query()->where('title', 'Saugmotor-Abend')->firstOrFail();
    $photos = EventPhoto::query()->with(['media', 'uploader'])->where('event_id', $meet->id)->orderBy('sort')->get();
    $files = $photos->map(fn (EventPhoto $photo): string => substr((string) $photo->media->getAttribute('sample_source'), strlen(ShowcaseEvents::GALLERY_SOURCE)))->all();

    expect($meet->ends_at?->isPast())->toBeTrue()
        ->and($photos)->toHaveCount(11)
        ->and($photos->every(fn (EventPhoto $photo): bool => $photo->is_sample))->toBeTrue()
        // M5.10: nine approved (more than the detail's preview, so "Alle Fotos" shows) and two waiting for the organiser's review.
        ->and($photos->where('status', GalleryPhotoStatus::Approved))->toHaveCount(9)
        ->and($photos->where('status', GalleryPhotoStatus::Approved)->count())->toBeGreaterThan(config()->integer('speedclub.events.gallery_preview'))
        ->and($photos->where('status', GalleryPhotoStatus::Pending))->toHaveCount(2)
        ->and(array_unique($files))->toHaveCount(11)
        ->and(array_intersect($files, $this->covers))->toBe([])
        ->and($photos->pluck('uploader.username')->unique()->values()->all())->toContain('max.e46', 'lena.911');

    $ids = $photos->modelKeys();
    app(ShowcaseEvents::class)->seed(photos: $this->photos);
    expect(EventPhoto::query()->where('event_id', $meet->id)->orderBy('sort')->pluck('id')->all())->toBe($ids)
        ->and(Media::query()->where('sample_source', 'like', ShowcaseEvents::GALLERY_SOURCE.'%')->count())->toBe(11);
});
