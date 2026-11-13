<?php

namespace App\Http\Controllers\Api\V1\Social;

use App\Actions\Social\SaveVehicle;
use App\Actions\Social\UnsaveVehicle;
use App\Enums\ErrorCode;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social\OwnListRequest;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Http\Resources\V1\SavedVehicleResource;
use App\Http\Resources\V1\SaveStateResource;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * Saved builds [SIG sig.saved_builds] (02_PRODUCT_SPEC §3.5, PROF-05). No verification needed (ADR-139). While the flag is off every
 * route answers 404 `feature_disabled` (EnsureFeatureEnabled).
 */
class SaveController extends Controller
{
    /**
     * Save a build.
     *
     * 300 saves and unsaves a day. Saving twice changes nothing. `{vehicle}` is the vehicle's id. 404 `vehicle_unavailable` for
     * anything the viewer may not view, as on the vehicle page (public or unlisted, owner visible, no block); your own vehicle: 403.
     */
    public function store(Request $request, string $vehicle, SaveVehicle $action): SaveStateResource
    {
        /** @var User $user */
        $user = $request->user();
        $target = Vehicle::query()->find($vehicle);

        if (! $target instanceof Vehicle || ! Gate::allows('view', $target)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        Gate::authorize('create', [Save::class, $target]);

        $action->handle($user, $target);

        return SaveStateResource::of($target->id, true);
    }

    /**
     * Stop saving a build.
     *
     * Any id answers 200 with `is_saved` false, also for a build that went private or was deleted since.
     */
    public function destroy(Request $request, string $vehicle, UnsaveVehicle $action): SaveStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('unsave', Save::class);

        $action->handle($user, $vehicle);

        return SaveStateResource::of($vehicle, false);
    }

    /**
     * List my saved builds.
     *
     * Newest save first, as feed cards with `saved_at`. Builds the member can no longer view are left out while that lasts; their
     * saves stay and come back when the build does.
     */
    public function index(OwnListRequest $request, VisibleBuilds $builds): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewAny', Save::class);

        $saved = $user->savedVehicles()
            ->withPivot('id')
            ->where('vehicles.status', VehicleStatus::Published)
            ->where('vehicles.visibility', '!=', Visibility::Private)
            ->whereHas('owner', fn ($owner) => $owner
                ->whereNull('users.deleted_at')
                ->where('users.status', UserStatus::Active)
                ->whereNotNull('users.email_verified_at')
                // 09 §8.19: a saved sample build stays saved but is left out while editorial_samples is off.
                ->when(! $builds->samplesVisible(), fn ($hidden) => $hidden->where('users.is_sample', false)))
            ->with(FeedVehicleResource::RELATIONS)
            ->withCount('modifications')
            ->orderByDesc('saves.created_at')
            ->orderByDesc('saves.id');

        $builds->withoutBlocks($saved->getBaseQuery(), $user, 'vehicles.owner_id');
        $builds->withoutSamples($saved->getBaseQuery(), 'vehicles.is_sample');

        return SavedVehicleResource::collection($saved->cursorPaginate($request->pageSize(), ['vehicles.*'])->withQueryString());
    }
}
