<?php

namespace App\Actions\Social;

use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;

/**
 * A private bookmark [SIG sig.saved_builds]; the owner only ever learns an aggregated count (02_PRODUCT_SPEC §3.5). Idempotent through
 * the unique pair: saving twice keeps one row and its first date.
 */
class SaveVehicle
{
    public function handle(User $user, Vehicle $vehicle): void
    {
        Save::query()->insertOrIgnore([
            'user_id' => $user->id,
            'vehicle_id' => $vehicle->id,
            'created_at' => now(),
        ]);
    }
}
