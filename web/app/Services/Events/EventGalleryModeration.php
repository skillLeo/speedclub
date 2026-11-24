<?php

namespace App\Services\Events;

use App\Enums\GalleryPhotoStatus;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\EventPhoto;

/**
 * M5.6 (m5.6-contract §4.5): what a staff decision on a reported gallery photo (report target `photo`, the media id) does to its gallery
 * row. ContentRemoval calls removed() inside DecideCase's transaction (the decision row is already written, so it names the staff member;
 * DecideCase records the audit event and tells the uploader); ContentRestoration calls restored() when the decision is reversed.
 * Staff removal wins over the organiser: a removed photo cannot be approved, rejected or deleted through the member API.
 */
class EventGalleryModeration
{
    public function removed(EventPhoto $photo): void
    {
        $decision = Decision::query()->whereIn('case_id', fn ($cases) => $cases->select('id')->from('moderation_cases')
            ->where('target_type', ReportTargetType::Photo->value)->where('target_id', $photo->media_id))
            ->latest('decided_at')->latest('id')->first();

        $photo->forceFill([
            'status' => GalleryPhotoStatus::Removed,
            'removed_by_staff_id' => $decision?->getAttribute('decided_by'),
        ])->save();
    }

    public function restored(EventPhoto $photo, ?string $before): void
    {
        if ($photo->status !== GalleryPhotoStatus::Removed) {
            return;
        }

        $status = GalleryPhotoStatus::tryFrom((string) $before);

        $photo->forceFill([
            'status' => $status === null || $status === GalleryPhotoStatus::Removed ? GalleryPhotoStatus::Approved : $status,
            'removed_by_staff_id' => null,
        ])->save();
    }
}
