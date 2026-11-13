<?php

namespace App\Policies;

use App\Models\PasskeyChallenge;
use App\Models\User;

/**
 * WebAuthn challenges are server state of a ceremony (MemberWebAuthn); nobody reads or changes a row through a route.
 */
class PasskeyChallengePolicy
{
    public function view(User $user, PasskeyChallenge $challenge): bool
    {
        return false;
    }
}
