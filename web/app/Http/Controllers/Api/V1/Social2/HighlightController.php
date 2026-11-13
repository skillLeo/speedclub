<?php

namespace App\Http\Controllers\Api\V1\Social2;

use App\Actions\Social\SetHighlights;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Social2\SetHighlightsRequest;
use App\Http\Resources\V1\HighlightResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Social\VehicleHighlights;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * The Highlights rail of VEH-01 (09 §8.5): up to 8 updates or photos the owner pinned, permanent, in the owner's order.
 */
class HighlightController extends Controller
{
    /**
     * List a vehicle's highlights.
     *
     * Guests too, for a vehicle they may see. Items the viewer may not see (a hidden or followers-only update, a removed photo) are
     * left out.
     *
     * @unauthenticated
     */
    public function index(Request $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);

        if (! Gate::forUser($viewer)->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        return HighlightResource::collection(app(VehicleHighlights::class)->visible($vehicle, $viewer));
    }

    /**
     * Set a vehicle's highlights.
     *
     * The whole rail in order, `items: [{type: build_update|photo, id}]`, up to 8, each an update or a finished photo of this vehicle (or
     * of its updates). An empty list clears it. Owner only.
     */
    public function update(SetHighlightsRequest $request, Vehicle $vehicle, SetHighlights $action): AnonymousResourceCollection
    {
        Gate::authorize('update', $vehicle);

        /** @var list<array{type: string, id: string}> $items */
        $items = $request->validated('items');
        $action->handle($vehicle, $items);
        /** @var User $user */
        $user = $request->user();

        return HighlightResource::collection(app(VehicleHighlights::class)->visible($vehicle, $user));
    }
}
