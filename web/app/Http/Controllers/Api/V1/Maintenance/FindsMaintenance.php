<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Maintenance is the owner's (09 §8.8): every route authorises VehiclePolicy::maintain first, then finds the item or entry inside that
 * vehicle only (404 for anything else, so no id of another vehicle is confirmed).
 */
trait FindsMaintenance
{
    protected function owner(Request $request, Vehicle $vehicle): User
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('maintain', $vehicle);

        return $user;
    }

    protected function item(Vehicle $vehicle, string $id): MaintenanceItem
    {
        $item = MaintenanceItem::query()->whereKey(strtolower($id))->where('vehicle_id', $vehicle->id)->first();

        if (! $item instanceof MaintenanceItem) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $item->setRelation('vehicle', $vehicle);
    }

    protected function log(Vehicle $vehicle, string $id): MaintenanceLog
    {
        $log = MaintenanceLog::query()->whereKey(strtolower($id))->where('vehicle_id', $vehicle->id)->first();

        if (! $log instanceof MaintenanceLog) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $log->setRelation('vehicle', $vehicle);
    }
}
