<?php

namespace App\Policies;

use App\Models\DeviceInstall;
use App\Models\User;

/**
 * App installs (09 §8.4) are server state of the sign-in flows (DeviceInstalls); SET-06 shows them through the member's tokens. Nobody
 * reads or changes a row through a route of its own.
 */
class DeviceInstallPolicy
{
    public function view(User $user, DeviceInstall $install): bool
    {
        return false;
    }
}
