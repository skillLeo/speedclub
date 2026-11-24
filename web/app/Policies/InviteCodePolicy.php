<?php

namespace App\Policies;

use App\Models\InviteCode;
use App\Models\User;
use App\Services\Invites\InviteCodes;

/**
 * M5.9d invites (m5.9d contract §5): a member others may see (verified, active, a username, never a sample) has invite codes.
 */
class InviteCodePolicy
{
    public function viewAny(User $user): bool
    {
        return InviteCodes::mayInvite($user) || self::showcase($user);
    }

    /**
     * M5.9f: off production the staging showcase account sees its seeded codes (INV-01 with redeemed ones), and since the crawl triage
     * they work there like a real member's (InviteCodes::mayInvite); in production a sample's codes never work.
     */
    private static function showcase(User $user): bool
    {
        return ! app()->isProduction() && $user->getAttribute('is_sample') === true && ! $user->trashed() && $user->isPubliclyVisible() && $user->hasUsername();
    }

    public function view(User $user, InviteCode $invite): bool
    {
        return $invite->inviter_id === $user->id;
    }
}
