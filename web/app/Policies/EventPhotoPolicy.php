<?php

namespace App\Policies;

use App\Enums\GalleryPhotoStatus;
use App\Models\EventPhoto;
use App\Models\User;

/**
 * M5.6 gallery photos (m5.6-contract §4, §7). Seeing a photo: the uploader always (any status but removed); the organiser every photo of
 * an event they may see; anybody else an approved photo of an event they may see, by an uploader without a block either way. Deciding is
 * the organiser's, on a pending photo; deleting is the uploader's (own, any status) or the organiser's (any). Staff remove through
 * reports (DecideCase), never through these abilities.
 */
class EventPhotoPolicy
{
    public function view(?User $viewer, EventPhoto $photo): bool
    {
        if ($photo->trashed() || $photo->status === GalleryPhotoStatus::Removed) {
            return false;
        }

        if ($photo->isUploadedBy($viewer)) {
            return $viewer !== null && ! $viewer->isDeactivated();
        }

        $event = $photo->event;

        if (! app(EventPolicy::class)->view($viewer, $event)) {
            return false;
        }

        if ($event->isOrganisedBy($viewer)) {
            return true;
        }

        return $photo->status === GalleryPhotoStatus::Approved
            && ($viewer === null || ! $viewer->hasBlockWith($photo->uploader));
    }

    public function moderate(User $user, EventPhoto $photo): bool
    {
        return $photo->event->isOrganisedBy($user) && $user->isActive() && ! $photo->trashed();
    }

    /**
     * Taking a photo down stays open under a publishing restriction, like every delete of one's own content.
     */
    public function delete(User $user, EventPhoto $photo): bool
    {
        if ($user->isDeactivated() || $photo->trashed() || $photo->status === GalleryPhotoStatus::Removed) {
            return false;
        }

        return $photo->isUploadedBy($user) || $photo->event->isOrganisedBy($user);
    }
}
