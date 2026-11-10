<?php

namespace App\Http\Controllers\Api\V1\Social;

use App\Actions\Social\RemoveFollower;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\FollowerRemovedResource;
use App\Models\Follow;
use App\Models\User;
use App\Services\Garage\PublicMembers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * PROF-04 "Entfernen" on the member's own Follower tab.
 */
class FollowerController extends Controller
{
    public function __construct(private readonly PublicMembers $members) {}

    /**
     * Remove a follower.
     *
     * Any name answers 200 with `follows_you` false (as unfollowing does, ADR-142 b), so this route tells nothing about who exists or
     * who blocked whom. The follow goes whatever the follower's state. Counts against the 200 unfollows a day.
     */
    public function destroy(Request $request, string $username, RemoveFollower $action): FollowerRemovedResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('removeFollower', Follow::class);
        $follower = $this->members->find($username);
        $follow = $follower === null ? null : Follow::query()->where('follower_id', $follower->id)->where('followee_id', $user->id)->first();

        if ($follower !== null && $follow !== null) {
            Gate::authorize('delete', $follow);
            $action->handle($user, $follower);
        }

        return FollowerRemovedResource::of(mb_strtolower(trim($username)));
    }
}
