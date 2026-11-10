<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Team\StaffCodes;
use App\Services\Team\TeamRefused;

/**
 * ADM-51 "Wiederherstellungscodes anzeigen" (SEC-P1-36): only after a current code, and audited on view (the codes never reach the
 * row). The controller answers no-store.
 *
 * @throws TeamRefused no_two_factor, code_invalid, too_many_codes
 */
class ShowRecoveryCodes
{
    public function __construct(private readonly StaffCodes $codes) {}

    /**
     * @return list<string>
     */
    public function handle(Staff $staff, string $code): array
    {
        $this->codes->ensure($staff, $code);

        /** @var list<string> $codes */
        $codes = array_values(array_map(strval(...), $staff->recoveryCodes()));
        Audit::record(StaffSecurityEvent::RecoveryCodesViewed->value, $staff, after: ['count' => count($codes)], actor: $staff);

        return $codes;
    }
}
