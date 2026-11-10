<?php

namespace App\Http\Controllers\Admin\Account;

use App\Actions\Admin\Account\RevokeOwnSession;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-51 own sessions: sign one other session out by its handle, or every other one. This session stays (sign-out ends it).
 */
class AccountSessionsController extends Controller
{
    use TeamResponses;

    public function destroy(Request $request, string $handle, RevokeOwnSession $revoke): RedirectResponse
    {
        return $this->step(fn () => $revoke->handle(self::staff($request), $handle, $request->session()), 'account.flash.session_ended');
    }

    public function others(Request $request, RevokeOwnSession $revoke): RedirectResponse
    {
        return $this->step(fn () => $revoke->others(self::staff($request), $request->session()), 'account.flash.sessions_ended');
    }

    private static function staff(Request $request): Staff
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $staff;
    }
}
