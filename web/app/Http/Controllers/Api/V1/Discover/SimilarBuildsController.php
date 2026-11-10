<?php

namespace App\Http\Controllers\Api\V1\Discover;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\Vehicle;
use App\Services\Discover\SimilarBuilds;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * "Ähnliche Builds" of VEH-01 [SIG sig.similar_builds] (m2.3 contract §7). 404 `feature_disabled` while the flag is off (middleware).
 */
class SimilarBuildsController extends Controller
{
    /**
     * List builds similar to a vehicle.
     *
     * `{id}` is the vehicle's id. At most 8: the same generation, then the same model, then the same make within ±20 % power; more
     * shared mod categories first. At most 2 per owner, never the base build's owner. 404 `vehicle_unavailable` for anything the
     * viewer may not view, as on the vehicle page. An empty list hides the strip.
     *
     * @unauthenticated
     */
    public function __invoke(Request $request, string $id, SimilarBuilds $similar): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);
        $vehicle = Vehicle::query()->find($id);

        if (! $vehicle instanceof Vehicle || ! Gate::forUser($viewer)->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        return FeedVehicleResource::collection($similar->for($viewer, $vehicle));
    }
}
