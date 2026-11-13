<?php

namespace App\Actions\Social;

use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Social\Collections;
use Illuminate\Support\Facades\DB;

/**
 * A private bookmark [SIG sig.saved_builds]; the owner only ever learns an aggregated count (02_PRODUCT_SPEC §3.5). Idempotent through
 * the unique pair: saving twice keeps one row and its first date. M4.11 (09 §8.6): the build also goes into the member's default
 * collection "Gespeichert".
 */
class SaveVehicle
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(User $user, Vehicle $vehicle): void
    {
        DB::transaction(function () use ($user, $vehicle): void {
            Save::query()->insertOrIgnore([
                'user_id' => $user->id,
                'vehicle_id' => $vehicle->id,
                'created_at' => now(),
            ]);
            $this->collections->saved($user, $vehicle);
        });
    }
}
