<?php

namespace App\Policies;

use App\Models\User;

/**
 * Catalogue data: everyone reads it, guests included. Changes are staff only, through the admin
 * permissions, so members have no create, update or delete ability here.
 */
abstract class PublicReadPolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    public function view(?User $user): bool
    {
        return true;
    }
}
