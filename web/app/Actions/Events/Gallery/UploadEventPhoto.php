<?php

namespace App\Actions\Events\Gallery;

use App\Enums\ErrorCode;
use App\Enums\GalleryPhotoSource;
use App\Enums\GalleryPhotoStatus;
use App\Enums\MediaCategory;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\User;
use App\Services\Events\EventGallery;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use App\Services\Notifications\Notifier;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * M5.6 "Fotos hinzufügen" (m5.6-contract §4.4): one photo into an event's gallery, through MediaService like every upload (re-encoded,
 * EXIF/GPS stripped, WebP variants, blurhash, private original, and the member's plate blur pixelated into the master before any public
 * file exists, ADR-509). The organiser's photo is approved at once; an attendee's waits for the organiser. Window, attendance and the
 * limits (per attendee, organiser and event) are checked under the event's row lock, so parallel uploads cannot pass a limit together.
 *
 * An attendee's photo tells the organiser (`event_gallery_pending`: in-app, the push at most once per event and day, grouped with the number
 * waiting, m5.6-contract §4.6). Other attendees hear nothing: they find the photos on the page (10 §16, no engagement push).
 */
class UploadEventPhoto
{
    public function __construct(
        private readonly MediaService $media,
        private readonly EventGallery $gallery,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $user, Event $event, UploadedFile $file, ?string $alt, PlateBlurChoice $plateBlur): EventPhoto
    {
        $bytes = $this->media->inspectUpload($file);
        $this->assertLargeEnough($bytes);

        [$photo, $media] = DB::transaction(function () use ($user, $event, $alt, $plateBlur, $bytes): array {
            /** @var Event $locked */
            $locked = Event::query()->with('organiser')->whereKey($event->id)->lockForUpdate()->firstOrFail();
            $this->gallery->assertMayAdd($locked, $user);
            $organiser = $locked->isOrganisedBy($user);
            $this->assertWithinLimits($locked, $user, $organiser);

            $photo = new EventPhoto;
            $photo->forceFill([
                'id' => $photo->newUniqueId(),
                'event_id' => $locked->id,
                'uploader_id' => $user->id,
                'source' => $organiser ? GalleryPhotoSource::Organiser : GalleryPhotoSource::Attendee,
                'status' => $organiser ? GalleryPhotoStatus::Approved : GalleryPhotoStatus::Pending,
                'reviewed_by' => $organiser ? $user->id : null,
                'reviewed_at' => $organiser ? now() : null,
                'sort' => $organiser ? self::nextSort($locked) : 0,
                'is_sample' => false,
            ]);

            $media = $this->media->reserve($user, $photo, ['alt' => $alt, 'category' => MediaCategory::Event], strlen($bytes), plateBlur: $plateBlur);
            $photo->forceFill(['media_id' => $media->id])->save();

            return [$photo, $media];
        });

        $this->media->processOrQueue($media, $bytes);

        if ($photo->status === GalleryPhotoStatus::Pending) {
            $event->loadMissing('organiser');
            $waiting = EventPhoto::query()->where('event_id', $event->id)->where('status', GalleryPhotoStatus::Pending->value)->count();
            $this->notifier->eventGalleryPending($event->organiser, $event, $waiting);
        }

        return $photo->fresh(['media', 'uploader.avatar', 'event']) ?? $photo;
    }

    /**
     * The next place in approval order (oldest approval first).
     */
    public static function nextSort(Event $event): int
    {
        return (int) EventPhoto::withTrashed()->where('event_id', $event->id)->max('sort') + 1;
    }

    /**
     * @throws ApiException 422 with a field error on `file`
     */
    private function assertLargeEnough(string $bytes): void
    {
        $size = @getimagesizefromstring($bytes);
        $min = config()->integer('speedclub.events.gallery_min_short_side');

        if (is_array($size) && min((int) $size[0], (int) $size[1]) < $min) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['file' => [(string) __('events.photo_too_small', ['min' => $min])]]);
        }
    }

    /**
     * @throws ApiException 409 limit_reached
     */
    private function assertWithinLimits(Event $event, User $user, bool $organiser): void
    {
        /** @var array{attendee: int, organiser: int, event: int} $limits */
        $limits = config('speedclub.events.gallery_limits');
        $own = $organiser ? $limits['organiser'] : $limits['attendee'];

        // SEC-P5-12: an attendee's deleted photos keep counting (delete and upload again would refill the limit without end).
        if ($this->gallery->counted($event, $user, ! $organiser) >= $own) {
            throw new ApiException(ErrorCode::LimitReached, (string) __('events.gallery_limit_own', ['max' => $own]));
        }

        if ($this->gallery->counted($event) >= $limits['event']) {
            throw new ApiException(ErrorCode::LimitReached, (string) __('events.gallery_limit_event', ['max' => $limits['event']]));
        }
    }
}
