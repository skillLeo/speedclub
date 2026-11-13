<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Actions\Maintenance\DeleteMaintenanceLog;
use App\Actions\Maintenance\SaveMaintenanceLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Maintenance\MaintenanceLogListRequest;
use App\Http\Requests\Api\V1\Maintenance\StoreMaintenanceLogRequest;
use App\Http\Requests\Api\V1\Maintenance\UpdateMaintenanceLogRequest;
use App\Http\Resources\V1\MaintenanceLogResource;
use App\Models\MaintenanceLog;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

/**
 * MNT-01 "Verlauf" (09 §8.8): the service log of one of the member's vehicles, costs included. Owner-only; `maintenance` flag.
 */
class MaintenanceLogController extends Controller
{
    use FindsMaintenance;

    /**
     * List service log entries.
     *
     * Newest first; `item_id` and `year` filter.
     */
    public function index(MaintenanceLogListRequest $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        $this->owner($request, $vehicle);
        $item = $request->validated('item_id');
        $year = $request->validated('year');

        $page = MaintenanceLog::query()->where('vehicle_id', $vehicle->id)
            ->when(is_string($item), fn ($query) => $query->where('item_id', strtolower((string) $item)))
            ->when(is_numeric($year), fn ($query) => $query->whereBetween('done_at', [$year.'-01-01', $year.'-12-31']))
            ->with('media')
            ->orderByDesc('done_at')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())
            ->withQueryString();

        return MaintenanceLogResource::collection($page);
    }

    /**
     * Show a service log entry.
     */
    public function show(Request $request, Vehicle $vehicle, string $log): MaintenanceLogResource
    {
        $this->owner($request, $vehicle);

        return new MaintenanceLogResource($this->log($vehicle, $log));
    }

    /**
     * Add a service log entry.
     *
     * Accepts an Idempotency-Key header and a client `id` (offline outbox): the same id again answers the entry with 200. An entry of an
     * item moves that item's last time and next due date; its mileage raises the vehicle's odometer.
     */
    public function store(StoreMaintenanceLogRequest $request, Vehicle $vehicle, SaveMaintenanceLog $action): MaintenanceLogResource
    {
        $this->owner($request, $vehicle);
        [$log, $created] = $action->add($vehicle, $request->validated());

        /** @status 201 */
        return (new MaintenanceLogResource($log))->delivered($created, false);
    }

    /**
     * Change a service log entry.
     *
     * Any subset of the fields. With `version`: 409 edit_conflict and the server's entry in `current` when it changed since.
     */
    public function update(UpdateMaintenanceLogRequest $request, Vehicle $vehicle, string $log, SaveMaintenanceLog $action): MaintenanceLogResource
    {
        $this->owner($request, $vehicle);

        return new MaintenanceLogResource($action->change($vehicle, $this->log($vehicle, $log), $request->validated()));
    }

    /**
     * Delete a service log entry.
     *
     * With its photos. Answers 204, also when it is gone already.
     */
    public function destroy(Request $request, Vehicle $vehicle, string $log, DeleteMaintenanceLog $action): Response
    {
        $this->owner($request, $vehicle);
        $found = MaintenanceLog::query()->whereKey(strtolower($log))->where('vehicle_id', $vehicle->id)->first();

        if ($found instanceof MaintenanceLog) {
            $action->handle($vehicle, $found);
        }

        return response()->noContent();
    }
}
