<?php

namespace App\Actions\Social;

use App\Models\Save;
use App\Models\User;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * By id alone, whatever the vehicle's state: a build that went private or was deleted can still leave the list. M4.11: it leaves every
 * collection of the member too, as a save and a build in a collection go together (Collections).
 */
class UnsaveVehicle
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(User $user, string $vehicleId): void
    {
        DB::transaction(function () use ($user, $vehicleId): void {
            Save::query()->where('user_id', $user->id)->where('vehicle_id', $vehicleId)->delete();
            $this->collections->unsaved($user, $vehicleId);
        });
    }
}
