<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Governance\Governance;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-51 "2FA ausschalten" (ADR-540): while 2FA für Admin-Konten is Optional, a staff member switches their own TOTP off with a recent
 * password only (route middleware staff.recent-password). The key, the recovery codes and a pending rotation are deleted, not kept;
 * audited as the security event `staff.two_factor_disabled` (via `self`). The switch is read again inside the row lock, so a change to
 * Pflicht in between wins. Nothing else changes: the sessions stay signed in, the next sign-in asks for the password only.
 *
 * @throws AuthorizationException
 */
class DisableOwnTwoFactor
{
    public function handle(Staff $staff): void
    {
        DB::transaction(function () use ($staff): void {
            /** @var Staff $locked */
            $locked = Staff::query()->whereKey($staff->getKey())->lockForUpdate()->firstOrFail();

            if (Governance::staffTwoFactorRequired() || ! $locked->hasEnabledTwoFactorAuthentication()) {
                throw new AuthorizationException;
            }

            $locked->forceFill([
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
                'two_factor_pending_secret' => null,
                'two_factor_pending_session' => null,
                'two_factor_pending_at' => null,
            ])->save();

            Audit::record(StaffSecurityEvent::TwoFactorDisabled->value, $locked, before: ['two_factor' => true], after: ['two_factor' => false, 'via' => 'self', 'policy' => Governance::TWO_FACTOR_OPTIONAL], actor: $locked);
        });

        $staff->refresh();
    }
}
