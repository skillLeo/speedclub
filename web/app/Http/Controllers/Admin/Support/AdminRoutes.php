<?php

namespace App\Http\Controllers\Admin\Support;

use App\Http\Middleware\EnsureStaffTwoFactor;

/**
 * Middleware of every signed-in admin route (contract §0). Route files use signedIn() and add their own `can:<atom>`.
 * staff.active and the access fence (IP allow-list, admin domain) are not listed: AdminServiceProvider puts them on the "staff"
 * group, so every admin route has them and none can forget them.
 */
final class AdminRoutes
{
    /**
     * @return list<string>
     */
    public static function signedIn(): array
    {
        return ['auth:staff', EnsureStaffTwoFactor::class];
    }
}
