<?php

namespace App\Actions\Admin\Account;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Team\StaffCodes;
use App\Services\Team\TeamRefused;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Fortify;

/**
 * ADM-51 "Authenticator wechseln", step 2 (SEC-P1-39): a code of the pending key, from the session that started the rotation and within
 * its time. Then the new key replaces the old one (recovery codes stay), every other session ends and this one keeps the new credentials
 * epoch (ADR-218); the view-as tokens the staff member started end with it (ADR-231).
 *
 * @throws TeamRefused no_rotation, rotation_elsewhere, rotation_expired, code_invalid, too_many_codes
 */
class ConfirmTotpRotation
{
    public function __construct(private readonly StaffCodes $codes) {}

    public function handle(Staff $staff, string $code, Session $session): void
    {
        $pending = PendingRotation::of($staff, $session);
        $this->codes->ensure($staff, $code, $pending);

        DB::transaction(function () use ($staff, $session, $pending): void {
            $locked = Staff::query()->whereKey($staff->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->two_factor_pending_secret !== $pending) {
                throw new TeamRefused('no_rotation');
            }

            $locked->forceFill([
                'two_factor_secret' => Fortify::currentEncrypter()->encrypt($pending),
                'two_factor_confirmed_at' => now(),
                'two_factor_pending_secret' => null,
                'two_factor_pending_session' => null,
                'two_factor_pending_at' => null,
            ])->save();

            StaffCredentials::rotate($locked, $session);

            Audit::record(StaffSecurityEvent::TwoFactorRotated->value, $locked, actor: $locked);
        });

        $staff->refresh();
    }
}
