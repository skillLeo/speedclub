<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * R4-2.1 (contract-cotd-voting V4): who may cast a Car of the Day vote. The route's not-restricted:publishing answers suspensions and
 * publishing restrictions first (403 account_restricted); the age of the account, sample accounts and the own car are the action's
 * (CastCarOfTheDayVote), with their own messages.
 */
class CarOfTheDayVotePolicy
{
    /** The round is read by every signed-in member; the reasons not to vote are part of it. */
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function create(User $user): Response|bool
    {
        if (! $user->isActive()) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }
}
