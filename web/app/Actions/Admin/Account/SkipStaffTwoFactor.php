<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Contracts\Session\Session;

/**
 * ADM-03 "Später einrichten" while speedclub.staff.two_factor_required is off: marks this session as skipped (EnsureStaffTwoFactor::SKIPPED).
 * Nothing changes on the account, so the next sign-in starts at enrolment again. Audited once per session.
 */
class SkipStaffTwoFactor
{
    public function handle(Staff $staff, Session $session): void
    {
        if ($session->get(EnsureStaffTwoFactor::SKIPPED) === true) {
            return;
        }

        $session->put(EnsureStaffTwoFactor::SKIPPED, true);
        Audit::record(StaffSecurityEvent::TwoFactorSkipped->value, $staff, actor: $staff);
    }
}
