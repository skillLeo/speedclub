<?php

namespace App\Policies;

use App\Enums\RestrictionType;
use App\Models\User;
use App\Services\Showcase\SampleContent;

class UserPolicy
{
    /**
     * Member search (DISC-02) takes guests. Who appears is the query's part: discoverable, publicly visible, no block either way
     * (App\Services\Discover\TextSearch).
     */
    public function viewAny(?User $viewer): bool
    {
        return true;
    }

    /**
     * Guests may browse member pages. Blocks hide both sides from each other (02_PRODUCT_SPEC §3.1, §3.5). A sample member is nobody
     * while editorial_samples is off (09 §8.19).
     */
    public function view(?User $viewer, User $member): bool
    {
        if ($viewer?->is($member)) {
            return ! $member->isDeactivated();
        }

        return $member->isPubliclyVisible()
            && ! app(SampleContent::class)->hides($member, $viewer)
            && ($viewer === null || ! $viewer->hasBlockWith($member));
    }

    /**
     * Account, security and privacy settings. Restrictions must not lock a member out of these.
     */
    public function update(User $user, User $member): bool
    {
        return $user->is($member) && ! $user->isDeactivated();
    }

    /**
     * Public profile content: name, bio, avatar, cover, username.
     */
    public function updateProfile(User $user, User $member): bool
    {
        return $user->is($member) && ! $user->isDeactivated() && ! $user->isRestrictedFrom(RestrictionType::Publishing);
    }

    /**
     * Account deletion and data export stay available under every restriction (GDPR).
     */
    public function delete(User $user, User $member): bool
    {
        return $user->is($member) && ! $user->isDeactivated();
    }
}
