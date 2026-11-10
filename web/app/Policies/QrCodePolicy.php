<?php

namespace App\Policies;

use App\Models\QrCode;
use App\Models\User;

/**
 * Owner management only. Resolving a scanned code is public and goes through App\Services\Qr, which
 * shows the state page and never reveals more than the vehicle's own visibility allows.
 */
class QrCodePolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, QrCode $qrCode): bool
    {
        $vehicle = $qrCode->vehicle;

        // A tombstone has no vehicle and so nobody who owns it.
        return $vehicle !== null && $vehicle->isOwnedBy($user) && ! $vehicle->trashed() && ! $user->isDeactivated();
    }
}
