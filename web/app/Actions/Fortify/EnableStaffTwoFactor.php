<?php

namespace App\Actions\Fortify;

use App\Enums\StaffSecurityEvent;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;

/**
 * Fortify's enable step (POST /admin/user/two-factor-authentication), bound in its place by FortifyServiceProvider: enrolment
 * is audited, and an unfinished enrolment may start over with `force=true`.
 *
 * Confirmed TOTP is never replaced here. Fortify 1.41 would write a new secret and new recovery codes on `force=true` and keep
 * two_factor_confirmed_at (vendor/laravel/fortify/src/Actions/EnableTwoFactorAuthentication.php): a working second factor nobody
 * confirmed, with the owner locked out. EnsureStaffTwoFactor closes the route for such an account (SEC-P1-22), this holds for any
 * other caller. A key change needs a step that asks for a current code first (ADM-51).
 *
 * The decision reads the locked row, not the model loaded at the start of the request, so a confirmation that committed in between
 * counts (SEC-P1-35). The other order is held by ConfirmStaffTwoFactor.
 *
 * A new secret belongs to the session that asked for it (SEC-P1-33): the session keeps a hash of it, and EnsureStaffTwoFactor lets only
 * that session read the key or the QR code or confirm it. The credentials epoch moves too, so every other session of the account ends
 * at the start of the enrolment (SEC-P1-25).
 */
final class EnableStaffTwoFactor extends EnableTwoFactorAuthentication
{
    /**
     * @param  Staff  $user
     * @param  bool  $force
     */
    public function __invoke($user, $force = false): void
    {
        DB::transaction(function () use ($user, $force): void {
            $current = Staff::query()->whereKey($user->getKey())->lockForUpdate()->sole();

            if (! empty($current->two_factor_secret) && ($force !== true || $current->hasEnabledTwoFactorAuthentication())) {
                return;
            }

            parent::__invoke($current, $force);

            $session = session()->driver();
            $session->put(EnsureStaffTwoFactor::PENDING_SECRET, EnsureStaffTwoFactor::secretFingerprint($current));
            StaffCredentials::rotate($current, $session);

            Audit::record(StaffSecurityEvent::TwoFactorEnabled->value, $current, actor: $current);
        });

        $user->refresh();
    }
}
