<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Actions\Maintenance\RecordOdometer;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Maintenance\OdometerRequest;
use App\Http\Resources\V1\MaintenanceCostsResource;
use App\Http\Resources\V1\OdometerResource;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceOverview;
use Illuminate\Http\Request;

/**
 * The vehicle-level parts of MNT-01: the odometer and the private cost totals (GAR-10 "Kosten", 09 §11). Owner-only.
 */
class VehicleMaintenanceController extends Controller
{
    use FindsMaintenance;

    /**
     * Set the mileage.
     *
     * The mileage now in km; km-based reminders count from it. Log entries with a higher mileage raise it by themselves.
     */
    public function odometer(OdometerRequest $request, Vehicle $vehicle, RecordOdometer $action): OdometerResource
    {
        $this->owner($request, $vehicle);

        return new OdometerResource($action->handle($vehicle, $request->integer('km')));
    }

    /**
     * Private cost totals.
     *
     * The owner's spending on the vehicle in euro cents: service log entries and mods (installed or removed, not planned), in total and
     * per year, newest year first. Never shown to anybody else.
     */
    public function costs(Request $request, Vehicle $vehicle, MaintenanceOverview $overview): MaintenanceCostsResource
    {
        $this->owner($request, $vehicle);

        return new MaintenanceCostsResource($overview->costs($vehicle));
    }
}
