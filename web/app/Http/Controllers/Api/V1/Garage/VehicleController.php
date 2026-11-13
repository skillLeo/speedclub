<?php

namespace App\Http\Controllers\Api\V1\Garage;

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Actions\Garage\CreateVehicleDraft;
use App\Actions\Garage\DeleteVehicle;
use App\Actions\Garage\PublishVehicle;
use App\Actions\Garage\ReorderVehicles;
use App\Actions\Garage\SetMainVehicle;
use App\Actions\Garage\UpdateVehicle;
use App\Actions\Garage\UpdateVehicleSpecs;
use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\ChangeVisibilityRequest;
use App\Http\Requests\Api\V1\Garage\GarageListRequest;
use App\Http\Requests\Api\V1\Garage\PublishVehicleRequest;
use App\Http\Requests\Api\V1\Garage\ReorderVehiclesRequest;
use App\Http\Requests\Api\V1\Garage\UpdateSpecsRequest;
use App\Http\Requests\Api\V1\Garage\VehicleAttributesRequest;
use App\Http\Resources\V1\VehicleCardResource;
use App\Http\Resources\V1\VehicleResource;
use App\Http\Resources\V1\VehicleSpecsSavedResource;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * The owner's garage (02_PRODUCT_SPEC §3.2, GAR-01 to GAR-06, GAR-12).
 */
class VehicleController extends Controller
{
    /**
     * My garage.
     *
     * Main vehicle first, then in the member's order. Drafts are part of it, with `wizard` saying where they resume, and every
     * vehicle has its completeness.
     */
    public function index(GarageListRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('viewAny', Vehicle::class);

        return VehicleCardResource::collection(
            $user->vehicles()
                ->with(VehicleCardResource::RELATIONS)
                ->withCount(['modifications', 'buildUpdates'])
                ->orderByDesc('is_main')
                ->orderBy('sort')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * Start a draft.
     *
     * Accepts an Idempotency-Key header. The body is optional: the wizard may save its first step here or later through PATCH.
     * Free text for make or model files a catalogue request. 20 vehicles per member, drafts included.
     */
    public function store(VehicleAttributesRequest $request, CreateVehicleDraft $action): VehicleResource
    {
        Gate::authorize('create', Vehicle::class);

        /** @var User $user */
        $user = $request->user();

        /** @status 201 */
        return new VehicleResource($this->loaded($action->handle($user, $request->validated())));
    }

    /**
     * Read a vehicle.
     *
     * The owner's view with completeness and QR. Anybody else who may see the vehicle gets the same shape without those; a
     * vehicle they may not see does not exist for them (404).
     */
    public function show(Vehicle $vehicle): VehicleResource
    {
        abort_unless(Gate::allows('view', $vehicle), 404);

        return new VehicleResource($this->loaded($vehicle));
    }

    /**
     * Update basics, or save a wizard step.
     *
     * Only the keys sent change. Choosing a catalogue entry clears the free text of that level and the other way round; a new
     * make clears a model that no longer fits.
     */
    public function update(VehicleAttributesRequest $request, Vehicle $vehicle, UpdateVehicle $action): VehicleResource
    {
        Gate::authorize('update', $vehicle);

        /** @var User $user */
        $user = $request->user();

        return new VehicleResource($this->loaded($action->handle($user, $vehicle, $request->validated())));
    }

    /**
     * Delete a vehicle.
     *
     * Soft delete: the QR code is revoked, the vehicle leaves search and the public photo files go at once. Hard delete after
     * 30 days. A main vehicle hands over to the next published one. Stays open under a publishing restriction.
     */
    public function destroy(Request $request, Vehicle $vehicle, DeleteVehicle $action): Response
    {
        Gate::authorize('delete', $vehicle);

        /** @var User $user */
        $user = $request->user();

        $action->handle($user, $vehicle);

        return response()->noContent();
    }

    /**
     * Replace the specs.
     *
     * The whole set: a key that is not sent is empty afterwards. Power is stored as entered, with its unit and provenance.
     * `history_recorded` says whether Verlauf now tells about this save: false for the same values, a torque source, the same
     * power in another unit and a value changed back within 10 minutes, and always on a draft.
     */
    public function specs(UpdateSpecsRequest $request, Vehicle $vehicle, UpdateVehicleSpecs $action): VehicleSpecsSavedResource
    {
        Gate::authorize('update', $vehicle);

        $recorded = $action->handle($vehicle, $request->validated());

        return new VehicleSpecsSavedResource($this->loaded($vehicle), $recorded);
    }

    /**
     * Publish a draft.
     *
     * Accepts an Idempotency-Key header. Needs make, model, model year, one finished photo and a username: 422
     * `vehicle_incomplete` lists everything missing in `missing` and `errors`. An unverified address gets 403
     * `email_not_verified`. The answer holds the new QR code. The first published vehicle becomes the main one. On a vehicle
     * that is published already it changes nothing, also not the visibility, and answers 200 with the vehicle as it is: a client
     * whose first answer got lost may safely ask again with a new key.
     */
    public function publish(PublishVehicleRequest $request, Vehicle $vehicle, PublishVehicle $action): VehicleResource
    {
        Gate::authorize('publish', $vehicle);

        /** @var User $user */
        $user = $request->user();

        return new VehicleResource($this->loaded($action->handle($user, $vehicle, $request->enum('visibility', Visibility::class))));
    }

    /**
     * Make this the main vehicle.
     *
     * Published vehicles only. The previous main vehicle stops being one.
     */
    public function main(Request $request, Vehicle $vehicle, SetMainVehicle $action): VehicleResource
    {
        Gate::authorize('setMain', $vehicle);

        /** @var User $user */
        $user = $request->user();

        return new VehicleResource($this->loaded($action->handle($user, $vehicle)));
    }

    /**
     * Reorder the garage.
     *
     * `ids` must hold every vehicle that is not a draft exactly once.
     */
    public function reorder(ReorderVehiclesRequest $request, ReorderVehicles $action): AnonymousResourceCollection
    {
        Gate::authorize('create', Vehicle::class);

        /** @var User $user */
        $user = $request->user();
        /** @var list<string> $ids */
        $ids = $request->validated('ids');

        $action->handle($user, $ids);

        return VehicleCardResource::collection(
            $user->vehicles()->with(VehicleCardResource::RELATIONS)->withCount(['modifications', 'buildUpdates'])->orderByDesc('is_main')->orderBy('sort')->orderBy('id')->get()
        );
    }

    /**
     * Change the visibility.
     *
     * Reaches search within this request. Going private stays possible under a publishing restriction; anything else then
     * answers 403 `account_restricted`.
     */
    public function visibility(ChangeVisibilityRequest $request, Vehicle $vehicle, ChangeVehicleVisibility $action): VehicleResource
    {
        /** @var Visibility $visibility */
        $visibility = $request->enum('visibility', Visibility::class);
        /** @var User $user */
        $user = $request->user();

        if ($visibility !== Visibility::Private && $user->isRestrictedFrom(RestrictionType::Publishing)) {
            throw ApiException::accountRestricted($user->restrictedUntil(RestrictionType::Publishing));
        }

        Gate::authorize('changeVisibility', [$vehicle, $visibility]);

        return new VehicleResource($this->loaded($action->handle($vehicle, $visibility)));
    }

    private function loaded(Vehicle $vehicle): Vehicle
    {
        return $vehicle->refresh()->load(VehicleCardResource::RELATIONS)->loadCount('modifications');
    }
}
