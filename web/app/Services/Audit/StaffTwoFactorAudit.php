<?php

namespace App\Services\Audit;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use Illuminate\Contracts\Events\Dispatcher;
use Laravel\Fortify\Events\RecoveryCodeReplaced;
use Laravel\Fortify\Events\RecoveryCodesGenerated;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;

/**
 * The staff 2FA steps that Fortify runs itself, into the audit log (enrolment: EnableStaffTwoFactor). Registered
 * by FortifyServiceProvider; it lives outside app/Listeners, so event discovery cannot register it a second time.
 * Members do not use Fortify, so only Staff is recorded. The event's recovery code never reaches the row.
 */
final class StaffTwoFactorAudit
{
    private const EVENTS = [
        TwoFactorAuthenticationConfirmed::class => StaffSecurityEvent::TwoFactorConfirmed,
        TwoFactorAuthenticationDisabled::class => StaffSecurityEvent::TwoFactorDisabled,
        RecoveryCodesGenerated::class => StaffSecurityEvent::RecoveryCodesRegenerated,
        RecoveryCodeReplaced::class => StaffSecurityEvent::RecoveryCodeUsed,
    ];

    public function subscribe(Dispatcher $events): void
    {
        foreach (array_keys(self::EVENTS) as $event) {
            $events->listen($event, [self::class, 'handle']);
        }
    }

    public function handle(TwoFactorAuthenticationConfirmed|TwoFactorAuthenticationDisabled|RecoveryCodesGenerated|RecoveryCodeReplaced $event): void
    {
        if ($event->user instanceof Staff) {
            Audit::record(self::EVENTS[$event::class]->value, $event->user, actor: $event->user);
        }
    }
}
