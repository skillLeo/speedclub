<?php

namespace App\Actions\Social;

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Services\Notifications\Notifier;
use Throwable;

/**
 * Follow a build without following its owner (09 §8.6). Idempotent through the unique pair; only a new follow tells the owner
 * (vehicle_follower, grouped per build and day). The count stays the owner's.
 */
class FollowVehicle
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(User $user, Vehicle $vehicle): void
    {
        $inserted = VehicleFollow::query()->insertOrIgnore([
            'user_id' => $user->id,
            'vehicle_id' => $vehicle->id,
            'created_at' => now(),
        ]);

        if ($inserted === 1 && $vehicle->owner instanceof User) {
            try {
                $this->notifier->vehicleFollower($vehicle->owner, $user, $vehicle);
            } catch (Throwable $exception) {
                report($exception);
            }
        }
    }
}
