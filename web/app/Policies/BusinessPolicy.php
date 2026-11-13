<?php

namespace App\Policies;

use App\Enums\BusinessRole;
use App\Enums\ErrorCode;
use App\Models\Business;
use App\Models\User;
use App\Services\Showcase\SampleContent;
use Illuminate\Auth\Access\Response;

/**
 * Business profiles (09 §8.10, ADR-414). Reading: the business team (owner and staff) always; anybody else only a verified business
 * that no moderation decision removed, whose owner is publicly visible, without a block with the owner, samples only while shown.
 * Editing the profile and deciding portfolio tags: the team while active. Managing the team and closing the business: the owner.
 * Applying: an active member with a verified e-mail (one business per member, CreateBusiness).
 */
class BusinessPolicy
{
    public function view(?User $viewer, Business $business): bool
    {
        if ($viewer !== null && $business->roleOf($viewer) !== null) {
            return ! $viewer->isDeactivated();
        }

        if (! $business->isPublic() || app(SampleContent::class)->hides($business, $viewer)) {
            return false;
        }

        $owner = $business->owner;

        return $owner->isPubliclyVisible() && ($viewer === null || ! $viewer->hasBlockWith($owner));
    }

    public function create(User $user): Response|bool
    {
        if (! $user->isActive()) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * Edit the profile, upload logo and cover, see BIZ-03 and decide tags: owner and staff, while active.
     */
    public function update(User $user, Business $business): bool
    {
        return $user->isActive() && $business->roleOf($user) !== null && $business->removed_at === null;
    }

    /**
     * Team and closing: the owner.
     */
    public function manage(User $user, Business $business): bool
    {
        return ! $user->isDeactivated() && $business->roleOf($user) === BusinessRole::Owner;
    }
}
