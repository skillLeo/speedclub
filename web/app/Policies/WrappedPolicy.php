<?php

namespace App\Policies;

use App\Models\User;
use App\Models\Wrapped;

/**
 * M5.9e Season Wrapped: a Wrapped is its member's alone (contract §1, own data only). Nobody else reads it, its card images or its
 * share counter; staff see it only through the admin preview (GenerateWrappedForUser, audited). Sharing it is publishing: a member
 * restricted from publishing still watches their story but does not share it (the app hides the share action, the server refuses).
 */
class WrappedPolicy
{
    /** GET me/wrapped: the member's own list. */
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, Wrapped $wrapped): bool
    {
        return $wrapped->user_id === $user->id && ! $user->isDeactivated();
    }

    public function share(User $user, Wrapped $wrapped): bool
    {
        return $this->view($user, $wrapped);
    }
}
