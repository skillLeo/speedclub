<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\FollowVehicle;
use App\Actions\Social\UnfollowVehicle;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\VehicleFollowStateResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Follow a build without following the person (09 §8.6, flag vehicle_follow). Its updates join "Folge ich" and the follower's
 * notifications; the count is the owner's alone (VehicleSocialResource).
 */
class VehicleFollowController extends Controller
{
    /**
     * Follow a build.
     *
     * Idempotent. Own build: 403. Unverified: 403 email_not_verified. Anything the viewer may not see, also across a block: 404
     * vehicle_unavailable.
     */
    public function update(Request $request, string $vehicle, FollowVehicle $action): VehicleFollowStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $target = preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $vehicle) === 1 ? Vehicle::query()->find(strtolower($vehicle)) : null;

        if (! $target instanceof Vehicle || ! Gate::allows('view', $target)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        Gate::authorize('create', [VehicleFollow::class, $target]);

        $action->handle($user, $target);

        return VehicleFollowStateResource::of($target->id, true);
    }

    /**
     * Stop following a build.
     *
     * Any id answers 200 with is_following false, also for a build that went private or was deleted.
     */
    public function destroy(Request $request, string $vehicle, UnfollowVehicle $action): VehicleFollowStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('delete', VehicleFollow::class);

        $action->handle($user, $vehicle);

        return VehicleFollowStateResource::of(strtolower($vehicle), false);
    }
}
