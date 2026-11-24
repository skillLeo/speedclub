<?php

namespace App\Policies;

use App\Models\Spot;
use App\Models\User;

/**
 * M5.9b STREET DEX: a spot is the spotter's alone (its reveal, DEX-03). The car's owner sees spots only as numbers (spot-stats), never a
 * single spot; staff see them in the admin (part 2). Spotting itself is POST spots with its own rules (RecordSpot).
 */
class SpotPolicy
{
    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, Spot $spot): bool
    {
        return $spot->spotter_id === $user->id && ! $user->isDeactivated();
    }

    /**
     * GET me/dex and me/dex/sets: the member's own Dex.
     */
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }
}
