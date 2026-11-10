<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Support\Facades\DB;

/**
 * ADM-51 "Abbrechen": the pending key goes; the confirmed one never stopped working. Any session of the account may cancel (it only
 * takes something away).
 */
class CancelTotpRotation
{
    public function handle(Staff $staff): void
    {
        if ($staff->two_factor_pending_at === null) {
            return;
        }

        DB::transaction(function () use ($staff): void {
            $staff->forceFill(['two_factor_pending_secret' => null, 'two_factor_pending_session' => null, 'two_factor_pending_at' => null])->save();
            Audit::record(StaffSecurityEvent::TwoFactorRotationCancelled->value, $staff, actor: $staff);
        });
    }
}
