<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Auth\Access\Response;

/**
 * M4.11 (09 §8.6): following a build. As following a member: active, verified, not the own, and only what the member can see.
 */
class VehicleFollowPolicy
{
    public function create(User $user, Vehicle $vehicle): Response|bool
    {
        if (! $user->isActive() || $vehicle->isOwnedBy($user) || ! (new VehiclePolicy)->view($user, $vehicle)) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    public function delete(User $user): bool
    {
        return ! $user->isDeactivated();
    }
}
