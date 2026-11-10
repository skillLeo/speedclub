<?php

namespace App\Policies;

use App\Models\Block;
use App\Models\User;

class BlockPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * A safety tool: it stays available to unverified and restricted members.
     */
    public function create(User $user, User $member): bool
    {
        return ! $user->is($member) && ! $user->isDeactivated();
    }

    /**
     * Unblocking by name: any name answers the same, so this only asks who unblocks.
     */
    public function unblock(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function delete(User $user, Block $block): bool
    {
        return $block->blocker_id === $user->id;
    }
}
