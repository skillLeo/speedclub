<?php

namespace App\Services\Team;

use App\Enums\StaffAlertKind;
use App\Enums\StaffStatus;
use App\Jobs\Admin\DeliverStaffAlert;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\StaffAlert;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;

/**
 * Security mails to staff that must not be lost (SF-5 of the M5.1 review, ADR-507): each recipient gets a StaffAlert row and a queued
 * DeliverStaffAlert (database queue, retries with backoff, after the commit), which marks the row sent or failed and audits it. The
 * occasion (`$occasion`, e.g. the approval id) makes it idempotent: the same alert to the same person is queued once.
 */
final class StaffAlerts
{
    /**
     * @param  iterable<Staff>  $recipients
     * @param  array<string, string>  $payload  the mail's parameters (names, labels, the reason, a date): never a secret
     * @return list<int> the staff ids an alert was queued for
     */
    public function queue(StaffAlertKind $kind, string $occasion, iterable $recipients, array $payload): array
    {
        $queued = [];

        foreach ($recipients as $staff) {
            if ($staff->anonymised_at !== null || (string) $staff->email === '') {
                continue;
            }

            $alert = new StaffAlert;

            try {
                $alert->forceFill([
                    'kind' => $kind,
                    'dedupe_key' => $kind->value.':'.$occasion.':'.$staff->getKey(),
                    'staff_id' => $staff->getKey(),
                    'payload' => $payload,
                ])->save();
            } catch (UniqueConstraintViolationException) {
                continue;
            }

            DeliverStaffAlert::dispatch($alert->id)->afterCommit();
            $queued[] = (int) $staff->getKey();
        }

        return $queued;
    }

    /**
     * Who hears of an Owner-Override (SEC-P5-01 c): every active Owner and Admin, and every staff member (whatever their status now,
     * unless deleted) who approved a request in the last speedclub.approvals.override_alert_approver_days days, so an approver who was
     * cut out learns of it too.
     *
     * @return Collection<int, Staff>
     */
    public static function overrideAudience(): Collection
    {
        $privileged = Staff::query()->role(['owner', 'admin'], 'staff')->where('status', StaffStatus::Active)->whereNull('anonymised_at')->get();
        $approverIds = ApprovalRequest::query()
            ->whereNotNull('decided_by')
            ->whereColumn('decided_by', '!=', 'requested_by')
            ->where('decided_at', '>=', now()->subDays(config()->integer('speedclub.approvals.override_alert_approver_days')))
            ->distinct()->pluck('decided_by')->all();
        $approvers = Staff::query()->whereKey($approverIds)->whereNull('anonymised_at')->get();

        return $privileged->merge($approvers)->unique(fn (Staff $staff): int => (int) $staff->getKey())->values();
    }

    /**
     * Active Owners and Admins (SEC-P5-03: the governance switch).
     *
     * @return Collection<int, Staff>
     */
    public static function ownersAndAdmins(): Collection
    {
        return Staff::query()->role(['owner', 'admin'], 'staff')->where('status', StaffStatus::Active)->whereNull('anonymised_at')->get();
    }
}
