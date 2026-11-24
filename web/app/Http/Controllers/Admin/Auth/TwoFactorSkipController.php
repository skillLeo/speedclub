<?php

namespace App\Http\Controllers\Admin\Auth;

use App\Actions\Admin\Account\SkipStaffTwoFactor;
use App\Http\Controllers\Admin\Auth\Requests\SkipTwoFactorRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

/** ADM-03 "Später einrichten" (STAFF_2FA_REQUIRED=false): this session goes on to the dashboard without TOTP. */
class TwoFactorSkipController extends Controller
{
    public function __invoke(SkipTwoFactorRequest $request, SkipStaffTwoFactor $skip): RedirectResponse|Response
    {
        $skip->handle($request->staff(), $request->session());

        // A full page load: the admin's route list must be the signed-in one (StaffAuthChanged).
        return $request->header('X-Inertia') ? Inertia::location(route('admin.dashboard')) : redirect()->route('admin.dashboard', status: 303);
    }
}
