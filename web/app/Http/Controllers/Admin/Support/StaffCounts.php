<?php

namespace App\Http\Controllers\Admin\Support;

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
        if ($staff === null || ! $staff->hasEnabledTwoFactorAuthentication()) {
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
