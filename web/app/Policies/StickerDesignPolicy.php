<?php

namespace App\Policies;

use App\Models\StickerDesign;
use App\Models\User;

/**
 * M5.4: a design version belongs to its vehicle's owner, by the vehicle's abilities: reading and downloading as manageQr, changing and
 * ordering as designSticker (VehiclePolicy). Staff reach designs through the admin routes (atom stickers.print), never through this.
 */
class StickerDesignPolicy
{
    public function view(User $user, StickerDesign $design): bool
    {
        $vehicle = $design->vehicle;

        return $vehicle !== null && (new VehiclePolicy)->manageQr($user, $vehicle);
    }

    public function update(User $user, StickerDesign $design): bool
    {
        $vehicle = $design->vehicle;

        return $vehicle !== null && (new VehiclePolicy)->designSticker($user, $vehicle);
    }
}
