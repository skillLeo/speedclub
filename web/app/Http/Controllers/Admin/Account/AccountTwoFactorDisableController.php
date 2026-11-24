<?php

namespace App\Http\Controllers\Admin\Account;

use App\Actions\Admin\Account\DisableOwnTwoFactor;
use App\Http\Controllers\Admin\Account\Requests\DisableTwoFactorRequest;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/** ADM-51 "2FA ausschalten" (ADR-540, recent password on the route): back to ADM-51 with the success toast. */
class AccountTwoFactorDisableController extends Controller
{
    public function __invoke(DisableTwoFactorRequest $request, DisableOwnTwoFactor $disable): RedirectResponse
    {
        $disable->handle($request->staff());

        return back(303)->with('success', 'account.flash.two_factor_disabled');
    }
}
