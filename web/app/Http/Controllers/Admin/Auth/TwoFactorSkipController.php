<?php

namespace App\Http\Controllers\Admin\Auth;

use App\Actions\Admin\Account\SkipStaffTwoFactor;
use App\Http\Controllers\Admin\Auth\Requests\SkipTwoFactorRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/** ADM-03 "Später einrichten" (STAFF_2FA_REQUIRED=false): this session goes on to the dashboard without TOTP. */
class TwoFactorSkipController extends Controller
{
    public function __invoke(SkipTwoFactorRequest $request, SkipStaffTwoFactor $skip): RedirectResponse
    {
        $skip->handle($request->staff(), $request->session());

        return redirect()->route('admin.dashboard', status: 303);
    }
}
