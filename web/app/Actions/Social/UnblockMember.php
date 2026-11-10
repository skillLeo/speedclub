<?php

namespace App\Actions\Social;

use App\Models\Block;
use App\Models\User;

/**
 * Only the blocker's own row goes: a block the other member set stays, and nothing tells the blocker about it. Follows that the
 * block ended do not come back.
 *
 * SET-08 unblocks by the name its row shows, the name as sent. Once a renamed member's old name has stopped resolving (14 days), the
 * row is found by that name alone.
 */
class UnblockMember
{
    public function handle(User $blocker, ?User $member, string $asSent): void
    {
        Block::query()
            ->where('blocker_id', $blocker->id)
            ->where(fn ($query) => $query->where('blocked_username', mb_strtolower(trim($asSent)))
                ->when($member !== null, fn ($query) => $query->orWhere('blocked_id', $member?->id)))
            ->delete();
    }
}
