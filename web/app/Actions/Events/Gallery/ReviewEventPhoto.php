<?php

namespace App\Actions\Events\Gallery;

use App\Enums\ErrorCode;
use App\Enums\GalleryPhotoStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\EventPhoto;
use App\Models\User;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * M5.6 EVT-06 "Freigeben" / "Ablehnen" (m5.6-contract §4.4, §4.5): the organiser's decision on a pending attendee photo. Approved photos
 * take the next place in approval order; a rejected one keeps its row (with the reason, shown to the uploader only) and loses its files
 * after gallery_rejected_purge_days (events:housekeeping). A photo that is no longer pending: 409 photo_already_reviewed.
 *
 * The uploader hears about the decision in the app only (`event_photo_decided`, never a push).
 */
class ReviewEventPhoto
{
    public function __construct(private readonly Notifier $notifier) {}

    public function approve(User $organiser, EventPhoto $photo): EventPhoto
    {
        return $this->decide($organiser, $photo, GalleryPhotoStatus::Approved, null);
    }

    public function reject(User $organiser, EventPhoto $photo, ?string $reason): EventPhoto
    {
        $reason = $reason === null ? null : trim($reason);

        return $this->decide($organiser, $photo, GalleryPhotoStatus::Rejected, $reason === '' ? null : $reason);
    }

    private function decide(User $organiser, EventPhoto $photo, GalleryPhotoStatus $status, ?string $reason): EventPhoto
    {
        DB::transaction(function () use ($organiser, $photo, $status, $reason): void {
            /** @var Event $event */
            $event = Event::query()->whereKey($photo->event_id)->lockForUpdate()->firstOrFail();
            $locked = EventPhoto::query()->whereKey($photo->id)->lockForUpdate()->first();

            if (! $locked instanceof EventPhoto) {
                throw new ApiException(ErrorCode::EventPhotoUnavailable);
            }

            if ($locked->status !== GalleryPhotoStatus::Pending) {
                throw new ApiException(ErrorCode::PhotoAlreadyReviewed);
            }

            $locked->forceFill([
                'status' => $status,
                'reviewed_by' => $organiser->id,
                'reviewed_at' => now(),
                'reject_reason' => $status === GalleryPhotoStatus::Rejected ? $reason : null,
                'sort' => $status === GalleryPhotoStatus::Approved ? UploadEventPhoto::nextSort($event) : 0,
            ])->save();
        });

        $decided = $photo->fresh(['media', 'uploader.avatar', 'event.organiser']) ?? $photo;
        $this->notifier->eventPhotoDecided($decided->uploader, $decided->event, $decided);

        return $decided;
    }
}
