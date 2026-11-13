<?php

namespace App\Policies;

use App\Models\MemberCollection;
use App\Models\User;

/**
 * M4.11 (09 §8.6): collections are always private: the member alone reads and changes them. No verification needed, as for saves
 * (ADR-139); a deactivated account is refused.
 */
class MemberCollectionPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function create(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, MemberCollection $collection): bool
    {
        return $collection->user_id === $user->id && ! $user->isDeactivated();
    }

    public function update(User $user, MemberCollection $collection): bool
    {
        return $this->view($user, $collection);
    }

    /**
     * The default "Gespeichert" stays (renaming it is fine); the controller answers 409 for it.
     */
    public function delete(User $user, MemberCollection $collection): bool
    {
        return $this->view($user, $collection);
    }
}
