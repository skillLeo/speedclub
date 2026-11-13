<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\BuildUpdateListRequest;
use App\Http\Resources\V1\BuildUpdateResource;
use App\Http\Resources\V1\ModificationResource;
use App\Http\Resources\V1\PublicVehicleResource;
use App\Models\BuildUpdate;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Support\Viewer;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * VEH-01, VEH-02, VEH-05. Guests may read; a token only adds the viewer's units, is_following and the owner's view. Deleted,
 * private, draft, an owner who is not public, a block in either direction, or nothing at all: all the same 404, so none of them
 * can be told apart from outside.
 */
class PublicVehicleController extends Controller
{
    /**
     * Read a vehicle page.
     *
     * Only the public id at the end of the slug counts; any other text answers 301 to the canonical address. 404
     * `vehicle_unavailable` for everything the viewer may not see: the app shows "Fahrzeug nicht verfügbar".
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug): PublicVehicleResource|RedirectResponse
    {
        $vehicle = $this->visible($request, $slug);
        $canonical = $vehicle->canonicalSlug();

        if ($slug !== $canonical) {
            // Not to be kept: the address changes with the name, and a name can come back.
            return redirect()->route('api.v1.public.vehicles.show', ['slug' => $canonical], 301, ['Cache-Control' => 'no-cache, private']);
        }

        return new PublicVehicleResource($vehicle->load(PublicVehicleResource::DETAIL_RELATIONS));
    }

    /**
     * Read a modification of a vehicle page.
     *
     * For VEH-02. The cost is null for anybody but the owner (costs are never public).
     *
     * @unauthenticated
     */
    public function modification(Request $request, string $slug, string $modification): ModificationResource
    {
        $vehicle = $this->visible($request, $slug);
        $mod = $vehicle->modifications()->with(['category.fields', 'brand.mergedInto', 'media', 'vehicle'])->whereKey($modification)->first();

        if (! $mod instanceof Modification) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new ModificationResource($mod);
    }

    /**
     * List the build updates of a vehicle page.
     *
     * Verlauf beyond what the page carries. Newest first, no hidden entries unless the owner asks.
     *
     * @unauthenticated
     */
    public function updates(BuildUpdateListRequest $request, string $slug): AnonymousResourceCollection
    {
        $vehicle = $this->visible($request, $slug);

        $updates = $vehicle->buildUpdates();
        BuildUpdate::restrictTo($updates->getQuery(), Viewer::from($request), $vehicle);

        return BuildUpdateResource::collection(
            $updates
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * Read a build update of a vehicle page.
     *
     * For VEH-05. A hidden entry does not exist for anybody but the owner.
     *
     * @unauthenticated
     */
    public function update(Request $request, string $slug, string $update): BuildUpdateResource
    {
        $vehicle = $this->visible($request, $slug);
        $entry = $vehicle->buildUpdates()
            ->visibleTo(Viewer::from($request), $vehicle)
            ->whereKey($update)
            ->first();

        if ($entry === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return (new BuildUpdateResource($entry))->complete();
    }

    private function visible(Request $request, string $slug): Vehicle
    {
        $vehicle = Vehicle::findBySlug($slug);

        if ($vehicle === null || ! Gate::forUser(Viewer::from($request))->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        return $vehicle;
    }
}
