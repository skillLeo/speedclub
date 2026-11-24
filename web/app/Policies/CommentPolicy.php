<?php

namespace App\Policies;

use App\Enums\CommentStatus;
use App\Enums\ErrorCode;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Auth\Access\Response;

/**
 * M4.11 [build_comments]. Writing under an update is BuildUpdatePolicy::comment; R5-5: writing on the car itself is create(), the same
 * rules on the car.
 */
class CommentPolicy
{
    /**
     * A visible comment in a thread the member can see (the update as BuildUpdatePolicy::view decides, a car's own thread as
     * VehiclePolicy::view does), of an author nobody hides (active, verified, no block either way).
     */
    public function view(?User $user, Comment $comment): bool
    {
        $author = $comment->user;

        if ($comment->trashed() || $comment->status !== CommentStatus::Visible || ! $author instanceof User || ! $author->isPubliclyVisible()) {
            return false;
        }

        if ($user !== null && ! $author->is($user) && $user->hasBlockWith($author)) {
            return false;
        }

        if ($comment->isOnVehicle()) {
            $vehicle = $comment->vehicle;

            return $vehicle instanceof Vehicle && (new VehiclePolicy)->view($user, $vehicle);
        }

        $update = $comment->buildUpdate;

        return $update instanceof BuildUpdate && (new BuildUpdatePolicy)->view($user, $update);
    }

    /**
     * R5-5: who may write on a car's own thread, as BuildUpdatePolicy::comment for an update's: a member who can see the car, active
     * and verified; the owner too. Not on a draft (nobody else can see it, as no update exists on one). The owner's switch
     * (`comments_enabled`, SetVehicleComments) answers 403 comments_disabled. A publishing restriction is the route's (not-restricted).
     */
    public function create(User $user, Vehicle $vehicle): Response|bool
    {
        if (! $user->isActive() || $vehicle->isDraft() || ! (new VehiclePolicy)->view($user, $vehicle)) {
            return false;
        }

        if (! $user->hasVerifiedEmail()) {
            return Response::deny(code: ErrorCode::EmailNotVerified->value);
        }

        return $vehicle->getAttribute('comments_enabled') === false
            ? Response::deny(code: ErrorCode::CommentsDisabled->value)
            : true;
    }

    /**
     * The author, and the owner of the car (moderating their own build, its updates' threads and its own). Open under a restriction.
     */
    public function delete(User $user, Comment $comment): bool
    {
        if ($user->isDeactivated() || $comment->trashed()) {
            return false;
        }

        return $comment->user_id === $user->id || ($comment->threadVehicle()?->isOwnedBy($user) ?? false);
    }
}
