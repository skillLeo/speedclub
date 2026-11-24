<?php

namespace App\Services\Garage;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Dex\GhostMode;

/**
 * SEC-414-10 (DQ-1169 in one place): the member's profile cover as others see it, on WEB-02 /u, its og:image and the API (PROF-02).
 * A ready photo that staff did not reject; and a photo taken from one of the member's vehicles only while that vehicle is in the
 * public garage (published, public): a car that went private, unlisted or deleted never stays on the profile as its cover. The member
 * themselves still sees their own cover.
 */
final class MemberCovers
{
    public static function visible(User $member, ?User $reader = null): ?Media
    {
        $cover = $member->cover;

        if (! $cover instanceof Media || $cover->status !== MediaStatus::Ready || $cover->moderation_status === ModerationStatus::Rejected) {
            return null;
        }

        if ($reader !== null && $reader->is($member)) {
            return $cover;
        }

        if ($cover->getAttribute('mediable_type') !== (new Vehicle)->getMorphClass()) {
            return $cover;
        }

        $vehicle = Vehicle::query()->find($cover->getAttribute('mediable_id'));

        return $vehicle instanceof Vehicle
            && $vehicle->owner_id === $member->id
            && $vehicle->status === VehicleStatus::Published
            && $vehicle->visibility === Visibility::Public
            // M5.9b: a cover from a ghost car would show the car on the profile.
            && ! GhostMode::hides($vehicle, $reader)
            ? $cover : null;
    }
}
