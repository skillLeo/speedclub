<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Auth\Access\Response;

/**
 * M4.11 private reactions (09 §8.5, ADR-413). $target is the vehicle or the build update.
 */
class ReactionPolicy
{
    /**
     * Setting or changing the own reaction: an active member who can see the item and does not own it. Unverified: 403
     * email_not_verified, as for follows.
     */
    public function create(User $user, Vehicle|BuildUpdate $target): Response|bool
    {
        $vehicle = $target instanceof Vehicle ? $target : $target->vehicle;
        $visible = $target instanceof Vehicle ? (new VehiclePolicy)->view($user, $target) : (new BuildUpdatePolicy)->view($user, $target);

        if (! $user->isActive() || ! $visible || $vehicle->isOwnedBy($user)) {
            return false;
        }

        return $user->hasVerifiedEmail() ? true : Response::deny(code: ErrorCode::EmailNotVerified->value);
    }

    /**
     * Taking the own reaction back: any id, any state; only a closed account is refused.
     */
    public function delete(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    /**
     * Who reacted and how many: the owner only (09 §8.5). Nobody else ever reads a count.
     */
    public function viewAny(User $user, Vehicle|BuildUpdate $target): bool
    {
        $vehicle = $target instanceof Vehicle ? $target : $target->vehicle;

        return $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }
}
