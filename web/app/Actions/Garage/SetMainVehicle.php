<?php

namespace App\Actions\Garage;

use App\Enums\VehicleStatus;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;

/**
 * At most one Hauptfahrzeug per member, guarded by the member's row lock. The route read the vehicle before that lock, so it is read
 * again: a vehicle deleted or unpublished meanwhile must not take the title from the one that holds it. The title is housekeeping: only a
 * change to specs, mods or photos moves a build in "Neue Builds", so this writes past the model and leaves updated_at alone.
 */
class SetMainVehicle
{
    /** A backstop against a deadlock with what does not take the member's lock first. The closure starts with a fresh read, and a rollback undoes all it wrote. */
    private const ATTEMPTS = 3;

    public function handle(User $user, Vehicle $vehicle): Vehicle
    {
        DB::transaction(function () use ($user, $vehicle): void {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');
            $vehicle->refresh();

            if ($vehicle->trashed() || $vehicle->status !== VehicleStatus::Published) {
                return;
            }

            $user->vehicles()->where('is_main', true)->whereKeyNot($vehicle->id)->toBase()->update(['is_main' => false]);
            Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['is_main' => true]);
            $vehicle->refresh();
        }, self::ATTEMPTS);

        return $vehicle;
    }
}
