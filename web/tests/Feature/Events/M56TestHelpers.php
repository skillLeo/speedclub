<?php

use App\Enums\GalleryPhotoStatus;
use App\Models\Event;
use App\Models\EventCheckin;
use App\Models\EventPhoto;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/EventTestHelpers.php';

/**
 * M5.6 gallery and check-in test helpers, prefixed m56… so they never collide with another file's functions.
 */
function m56Flags(bool $gallery = true, bool $checkin = true): void
{
    evFlags(['events.gallery' => $gallery, 'events.checkin' => $checkin]);
}

/** Media on fake disks, as every upload test. */
function m56Disks(): void
{
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public']);
}

/** A published event that started two hours ago and ended an hour ago: gallery open, check-in open (120 min after the end). */
function m56JustEnded(?User $organiser = null, array $attributes = []): Event
{
    return evEvent($organiser, ['starts_at' => now()->subHours(2), 'ends_at' => now()->subHour(), ...$attributes]);
}

/** A photo the gallery accepts: 1200 × 900. */
function m56Photo(int $width = 1200, int $height = 900): UploadedFile
{
    return UploadedFile::fake()->image('treffen.jpg', $width, $height);
}

/** The multipart body of an upload, with the plate switched off unless regions are given. */
function m56Upload(?array $regions = null, array $extra = []): array
{
    return [
        'file' => m56Photo(),
        'plate_blur' => $regions === null ? '0' : '1',
        ...($regions === null ? [] : ['blur_regions' => json_encode($regions)]),
        ...$extra,
    ];
}

function m56GalleryPhoto(Event $event, User $uploader, GalleryPhotoStatus $status = GalleryPhotoStatus::Approved, array $attributes = []): EventPhoto
{
    return EventPhoto::factory()->create([
        'event_id' => $event->id,
        'uploader_id' => $uploader->id,
        'status' => $status,
        'sort' => $status === GalleryPhotoStatus::Approved ? (int) EventPhoto::query()->where('event_id', $event->id)->max('sort') + 1 : 0,
        'reviewed_at' => $status === GalleryPhotoStatus::Pending ? null : now(),
        ...$attributes,
    ]);
}

function m56Checkin(Event $event, User $member, array $attributes = []): EventCheckin
{
    return EventCheckin::factory()->create(['event_id' => $event->id, 'user_id' => $member->id, ...$attributes]);
}
