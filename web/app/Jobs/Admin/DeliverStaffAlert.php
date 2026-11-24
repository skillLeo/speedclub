<?php

namespace App\Jobs\Admin;

use App\Enums\StaffAlertEvent;
use App\Enums\StaffAlertKind;
use App\Mail\AuthMail;
use App\Mail\DraftTakenOverMail;
use App\Mail\OwnerOverrideMail;
use App\Mail\OwnerOverrideSwitchMail;
use App\Models\StaffAlert;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * Sends one StaffAlert (StaffAlerts, SF-5 of the M5.1 review): idempotent (a row already sent is skipped), retried with backoff, well
 * under 50 s (one mail). Success marks `sent_at` and audits `staff_alert.sent`; when the retries run out, `failed_at` and
 * `staff_alert.failed` (with the exception class only: transport messages quote addresses), so a lost alert is visible in ADM-44.
 * Carries the alert id only. The mail goes out in the org's default locale, as every staff mail (staff have no locale of their own).
 */
class DeliverStaffAlert implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public int $timeout = 50;

    public function __construct(public readonly string $alertId) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 900, 1800];
    }

    public function handle(AuthMailer $mailer, OrgIdentity $org): void
    {
        $alert = StaffAlert::query()->with('staff')->find($this->alertId);

        if ($alert === null || $alert->sent_at !== null) {
            return;
        }

        $staff = $alert->staff;
        $alert->forceFill(['attempts' => $alert->attempts + 1])->save();

        if ($staff === null || $staff->anonymised_at !== null) {
            $alert->forceFill(['failed_at' => now()])->save();
            Audit::record(StaffAlertEvent::Failed->value, $alert, after: ['kind' => $alert->kind->value, 'staff_id' => $alert->staff_id, 'error' => 'recipient_gone']);

            return;
        }

        $mailer->send((string) $staff->email, $org->defaultLocale(), self::mail($alert->kind, $alert->payload));

        $alert->forceFill(['sent_at' => now(), 'failed_at' => null])->save();
        Audit::record(StaffAlertEvent::Sent->value, $alert, after: ['kind' => $alert->kind->value, 'staff_id' => $alert->staff_id, 'attempts' => $alert->attempts]);
    }

    public function failed(?Throwable $exception): void
    {
        $alert = StaffAlert::query()->find($this->alertId);

        if ($alert === null || $alert->sent_at !== null) {
            return;
        }

        $alert->forceFill(['failed_at' => now()])->save();
        Audit::record(StaffAlertEvent::Failed->value, $alert, after: [
            'kind' => $alert->kind->value,
            'staff_id' => $alert->staff_id,
            'attempts' => $alert->attempts,
            'error' => $exception === null ? 'unknown' : $exception::class,
        ]);
    }

    /**
     * @param  array<string, string>  $payload
     */
    public static function mail(StaffAlertKind $kind, array $payload): AuthMail
    {
        $actor = $payload['actor'] ?? '';
        $reason = $payload['reason'] ?? '';
        $at = $payload['at'] ?? '';

        return match ($kind) {
            StaffAlertKind::OwnerOverride => new OwnerOverrideMail($actor, $payload['action'] ?? '', $reason, $at),
            StaffAlertKind::OverrideSwitch => new OwnerOverrideSwitchMail($actor, ($payload['enabled'] ?? '0') === '1', $reason, $at),
            StaffAlertKind::DraftTakenOver => new DraftTakenOverMail($actor, $payload['key'] ?? '', $reason, $at),
        };
    }
}
