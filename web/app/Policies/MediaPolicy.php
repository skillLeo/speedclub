<?php

namespace App\Policies;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\RestrictionType;
use App\Models\BuildUpdate;
use App\Models\Event;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;

class MediaPolicy
{
    /**
     * Owner sees all of theirs. Others only see finished, unrejected media of something they can see.
     * Unattached uploads and media of other types (messages come with their own rule) stay with the owner.
     */
    public function view(?User $user, Media $media): bool
    {
        if ($media->trashed()) {
            return false;
        }

        if ($user !== null && $media->owner_id === $user->id) {
            return ! $user->isDeactivated();
        }

        if ($media->status !== MediaStatus::Ready || $media->moderation_status === ModerationStatus::Rejected) {
            return false;
        }

        $parent = $media->mediable;

        return match (true) {
            $parent instanceof Vehicle => (new VehiclePolicy)->view($user, $parent),
            $parent instanceof Modification => (new ModificationPolicy)->view($user, $parent),
            $parent instanceof User => (new UserPolicy)->view($user, $parent),
            // M4.11: a photo of a build update, as the update.
            $parent instanceof BuildUpdate => (new BuildUpdatePolicy)->view($user, $parent),
            // M4.12: an event's cover, as the event.
            $parent instanceof Event => app(EventPolicy::class)->view($user, $parent),
            default => false,
        };
    }

    public function create(User $user): bool
    {
        return ! $user->isDeactivated() && ! $user->isRestrictedFrom(RestrictionType::Publishing);
    }

    public function update(User $user, Media $media): bool
    {
        return $media->owner_id === $user->id && ! $media->trashed() && $this->create($user);
    }

    public function delete(User $user, Media $media): bool
    {
        return $media->owner_id === $user->id && ! $media->trashed() && ! $user->isDeactivated();
    }
}
