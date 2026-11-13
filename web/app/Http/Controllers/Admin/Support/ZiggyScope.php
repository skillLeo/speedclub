<?php

namespace App\Http\Controllers\Admin\Support;

use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use Illuminate\Http\Request;

/**
 * Which routes the admin page source lists (SEC-P3-04): a guest, a staff member who has not shown TOTP yet and a client outside the
 * access fence get the `guest` group of config/ziggy.php (sign-in, challenge, reset, enrolment); only a signed-in staff member with
 * confirmed TOTP, or a session that skipped enrolment (ADR-427), gets every admin route, which the shell needs for navigation.
 */
final class ZiggyScope
{
    public static function group(Request $request): ?string
    {
        $staff = $request->user('staff');

        $signedIn = $staff instanceof Staff
            && (
                ($staff->hasEnabledTwoFactorAuthentication()
                    && ! ($request->hasSession() && $request->session()->get(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE) === true))
                // ADR-427: a session that skipped enrolment reaches the admin, so its shell needs the routes for navigation too.
                || EnsureStaffTwoFactor::skippedBy($request, $staff)
            );

        return $signedIn ? null : 'guest';
    }
}
