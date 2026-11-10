<?php

namespace App\Actions\Fortify;

use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use App\Services\Auth\StaffCredentials;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;

/**
 * Fortify's confirm step, bound in its place by FortifyServiceProvider: the code is verified against the locked row, not against
 * the model loaded at the start of the request. Otherwise a forced enable that commits in between leaves confirmed TOTP on a key
 * nobody has read, and the account locked out (SEC-P1-35). The other order is held by EnableStaffTwoFactor.
 *
 * A confirmed key is a new credential: every other session of the account ends (SEC-P1-25), this one keeps the new epoch.
 */
final class ConfirmStaffTwoFactor extends ConfirmTwoFactorAuthentication
{
    /**
     * @param  Staff  $user
     * @param  string  $code
     */
    public function __invoke($user, $code): void
    {
        DB::transaction(function () use ($user, $code): void {
            $locked = Staff::query()->whereKey($user->getKey())->lockForUpdate()->sole();
            parent::__invoke($locked, $code);
            StaffCredentials::rotate($locked, session()->driver());
            // ADM-03 shows the recovery codes once, right after this confirmation (SEC-P1-36).
            session()->driver()->put(EnsureStaffTwoFactor::RECOVERY_CODES_ONCE, true);
        });

        $user->refresh();
    }
}
