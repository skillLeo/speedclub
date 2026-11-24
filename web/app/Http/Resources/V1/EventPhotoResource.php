<?php

namespace App\Http\Resources\V1;

use App\Enums\GalleryPhotoSource;
use App\Enums\GalleryPhotoStatus;
use App\Models\EventPhoto;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.6 a gallery photo (m5.6-contract §4.3). The picture is the member media pipeline's (only the plate-blurred derivative is public,
 * ADR-509). A status other than `approved` and the reject reason reach the organiser and the uploader only (the reason the uploader
 * alone); removed photos are never sent. Load with media, uploader.avatar and event.
 *
 * @property EventPhoto $resource
 */
class EventPhotoResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $photo = $this->resource;
        $viewer = Viewer::from($request);
        $uploader = $photo->isUploadedBy($viewer);
        $organiser = $photo->event->isOrganisedBy($viewer);
        $insider = $uploader || $organiser;
        $active = $viewer !== null && ! $viewer->isDeactivated();

        return [
            'id' => $photo->id,
            'media' => new MediaResource($photo->media),
            /** @var GalleryPhotoSource */
            'source' => $photo->source,
            /**
             * pending · approved · rejected; everybody but the organiser and the uploader only ever reads approved.
             *
             * @var 'pending'|'approved'|'rejected'
             */
            'status' => $insider ? $photo->status->value : GalleryPhotoStatus::Approved->value,
            'uploader' => new MemberSummaryResource($photo->uploader),
            /**
             * Why the organiser turned it down; the uploader only.
             *
             * @var string|null
             */
            'reject_reason' => $uploader && $photo->status === GalleryPhotoStatus::Rejected ? $photo->reject_reason : null,
            'created_at' => $photo->created_at?->toIso8601String(),
            'reviewed_at' => $insider ? $photo->reviewed_at?->toIso8601String() : null,
            /** Seeded staging sample ("Beispiel" badge). */
            'is_sample' => $photo->is_sample,
            /**
             * What the reader may do: delete (own photo, or any as the organiser), report (somebody else's approved photo, through the
             * `photo` report target with `media.id`), moderate (the organiser, on a pending photo).
             *
             * @var array{delete: bool, report: bool, moderate: bool}
             */
            'can' => [
                'delete' => $active && $insider,
                'report' => $active && ! $uploader && $photo->status === GalleryPhotoStatus::Approved,
                'moderate' => $active && $organiser && $photo->status === GalleryPhotoStatus::Pending,
            ],
        ];
    }
}
