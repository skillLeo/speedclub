<?php

namespace App\Policies;

use App\Enums\RestrictionType;
use App\Models\CatalogRequest;
use App\Models\User;

class CatalogRequestPolicy
{
    /**
     * Part of the add-vehicle wizard, which also works before the email is verified.
     */
    public function create(User $user): bool
    {
        return ! $user->isDeactivated() && ! $user->isRestrictedFrom(RestrictionType::Publishing);
    }

    public function view(User $user, CatalogRequest $request): bool
    {
        return $request->user_id === $user->id;
    }
}
