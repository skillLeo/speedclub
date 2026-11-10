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
use Laravel\Fortify\RecoveryCode;

/**
 * ADM-51 "Neue Wiederherstellungscodes" (SEC-P1-36): only after a current code. Eight new codes replace the old ones; the credentials
 * epoch moves (ADR-218), so every other session ends and this one keeps going. Returned once for this answer (no-store).
 *
 * @throws TeamRefused no_two_factor, code_invalid, too_many_codes
 */
class RegenerateRecoveryCodes
{
    public const COUNT = 8;

    public function __construct(private readonly StaffCodes $codes) {}

    /**
     * @return list<string>
     */
    public function handle(Staff $staff, string $code, Session $session): array
    {
        $this->codes->ensure($staff, $code);

        /** @var list<string> $plain */
        $plain = array_map(fn (): string => RecoveryCode::generate(), range(1, self::COUNT));

        DB::transaction(function () use ($staff, $plain, $session): void {
            $staff->forceFill(['two_factor_recovery_codes' => Fortify::currentEncrypter()->encrypt((string) json_encode($plain))])->save();
            StaffCredentials::rotate($staff, $session);

            Audit::record(StaffSecurityEvent::RecoveryCodesRegenerated->value, $staff, after: ['via' => 'account', 'count' => self::COUNT], actor: $staff);
        });

        return $plain;
    }
}
