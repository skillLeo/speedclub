<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Actions\Maintenance\DeleteMaintenanceItem;
use App\Actions\Maintenance\SaveMaintenanceItem;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Maintenance\StoreMaintenanceItemRequest;
use App\Http\Requests\Api\V1\Maintenance\UpdateMaintenanceItemRequest;
use App\Http\Resources\V1\MaintenanceItemResource;
use App\Models\MaintenanceItem;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * MNT-01/02 (09 §7.12, §8.8): the maintenance items of one of the member's vehicles. Owner-only; `maintenance` flag.
 */
class MaintenanceItemController extends Controller
{
    use FindsMaintenance;

    /**
     * List maintenance items.
     *
     * Every item of the vehicle (at most 30), the nearest due first, those without a date last. `meta.odometer`: the vehicle's last known
     * mileage in km (`km` null when unknown).
     */
    public function index(Request $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        $this->owner($request, $vehicle);

        $items = MaintenanceItem::query()->where('vehicle_id', $vehicle->id)->get()
            ->each(fn (MaintenanceItem $item) => $item->setRelation('vehicle', $vehicle))
            ->sortBy(fn (MaintenanceItem $item): array => [$item->next_due_at === null ? 1 : 0, $item->next_due_at?->toDateString() ?? '', $item->type->value, $item->id])
            ->values();

        return MaintenanceItemResource::collection($items)->additional(['meta' => ['odometer' => [
            'km' => $vehicle->getAttribute('odometer_km'),
            'recorded_at' => $vehicle->getAttribute('odometer_at')?->toIso8601String(),
        ]]]);
    }

    /**
     * Add a maintenance item.
     *
     * Accepts an Idempotency-Key header and a client `id` (offline outbox): sending the same id again answers the item with 200. One item
     * per type except custom: 409 conflict with the existing item in `current`. 409 limit_reached at 30 items.
     */
    public function store(StoreMaintenanceItemRequest $request, Vehicle $vehicle, SaveMaintenanceItem $action): MaintenanceItemResource
    {
        [$item, $created] = $action->add($this->owner($request, $vehicle), $vehicle, $request->validated());

        /** @status 201 */
        return (new MaintenanceItemResource($item->setRelation('vehicle', $vehicle->refresh())))->delivered($created, false);
    }

    /**
     * Change a maintenance item.
     *
     * Any subset of the fields. With `version`: 409 edit_conflict and the server's item in `current` when it changed since.
     */
    public function update(UpdateMaintenanceItemRequest $request, Vehicle $vehicle, string $item, SaveMaintenanceItem $action): MaintenanceItemResource
    {
        $this->owner($request, $vehicle);
        $saved = $action->change($vehicle, $this->item($vehicle, $item), $request->validated());

        return new MaintenanceItemResource($saved->setRelation('vehicle', $vehicle->refresh()));
    }

    /**
     * Delete a maintenance item.
     *
     * Its log entries stay. The HU/AU item also clears the vehicle's HU/AU month. Answers 204, also when it is gone already.
     */
    public function destroy(Request $request, Vehicle $vehicle, string $item, DeleteMaintenanceItem $action): Response
    {
        $this->owner($request, $vehicle);
        $found = MaintenanceItem::query()->whereKey(strtolower($item))->where('vehicle_id', $vehicle->id)->first();

        if ($found instanceof MaintenanceItem) {
            $action->handle($vehicle, $found);
        }

        return response()->noContent();
    }
}
