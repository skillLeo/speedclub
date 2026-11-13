<?php

namespace App\Policies;

use App\Enums\ErrorCode;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Auth\Access\Response;

class BuildUpdatePolicy
{
    /**
     * The vehicle as VehiclePolicy decides, not hidden (owner excepted), and its audience (M4.11: followers-only reaches the owner and
     * followers of the owner or the vehicle).
     */
    public function view(?User $user, BuildUpdate $update): bool
    {
        return (new VehiclePolicy)->view($user, $update->vehicle) && $update->reaches($user);
    }

    /**
     * Owner note and, since M4.11, an owner post (UPD-01). Automatic updates come from Actions. A draft has no history yet (ADR-141).
     */
    public function create(User $user, Vehicle $vehicle): bool
    {
        return ! $vehicle->isDraft() && (new VehiclePolicy)->update($user, $vehicle);
    }

    /**
     * Hide or show again. Hiding stays possible under a publishing restriction; the controller refuses showing again, as it does
     * for a vehicle's visibility.
     */
    public function update(User $user, BuildUpdate $update): bool
    {
        return (new VehiclePolicy)->delete($user, $update->vehicle);
    }

    /**
     * M4.11 (09 §8.5): text, photos, mods, mileage, date and audience of an own post, within 24 hours of posting; afterwards 403
     * edit_window_closed (hiding and deleting stay open).
     */
    public function edit(User $user, BuildUpdate $update): Response|bool
    {
        if (! (new VehiclePolicy)->update($user, $update->vehicle) || ! $update->type->isAuthored()) {
            return false;
        }

        return $update->isEditable() ? true : Response::deny(code: ErrorCode::EditWindowClosed->value);
    }

    /**
     * M4.11: an own note or post; stays open under a restriction (a member can always take their own content down).
     */
    public function delete(User $user, BuildUpdate $update): bool
    {
        return $update->type->isAuthored() && (new VehiclePolicy)->delete($user, $update->vehicle);
    }

    /**
     * M4.11 [build_comments]: who may write a comment: a member who can see the update, active and verified; the owner too.
     */
    public function comment(User $user, BuildUpdate $update): Response|bool
    {
        if (! $user->isActive() || ! $this->view($user, $update)) {
            return false;
        }

        if (! $user->hasVerifiedEmail()) {
            return Response::deny(code: ErrorCode::EmailNotVerified->value);
        }

        return $update->vehicle->getAttribute('comments_enabled') === false
            ? Response::deny(code: ErrorCode::CommentsDisabled->value)
            : true;
    }
}
