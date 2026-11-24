<?php

namespace App\Http\Controllers\Admin\Support;

use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;

/**
 * Badge counts of the shell (contract §3). Read on every admin page, so they must stay cheap. Badges refresh on navigation only:
 * the admin makes no background requests (ADR-217).
 */
final class StaffCounts
{
    /**
     * @return array{approvals_for_me: int, alerts: int}
     */
    public static function for(?Staff $staff): array
    {
        // ADR-540: an account without TOTP gets its badges too while 2FA für Admin-Konten is Optional.
        if ($staff === null || (! $staff->hasEnabledTwoFactorAuthentication() && ! EnsureStaffTwoFactor::admitsWithoutCode($staff))) {
            return ['approvals_for_me' => 0, 'alerts' => 0];
        }

        $alerts = app(AlertsData::class);
        $approvals = $alerts->approvalCount($staff);

        return [
            'approvals_for_me' => $approvals,
            'alerts' => $approvals + $alerts->assignedCaseCount($staff) + count($alerts->systemWarnings($staff)),
        ];
    }
}
