<?php

namespace App\Policies;

use App\Models\LoginAttempt;
use App\Models\User;

/**
 * E-mail codes are server state of the sign-in flows (EmailCodes); nobody reads or changes a row through a route.
 */
class LoginAttemptPolicy
{
    public function view(User $user, LoginAttempt $attempt): bool
    {
        return false;
    }
}
