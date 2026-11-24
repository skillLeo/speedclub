<?php

namespace App\Actions\Admin\Approvals;

use App\Enums\ApprovalStatus;
use App\Enums\StaffAlertKind;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalConflict;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\OwnerOverride;
use App\Services\Approvals\OwnerOverrideRefused;
use App\Services\Team\StaffAlerts;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-43 / every pending notice "Selbst freigeben (Owner-Override)" ⚿ (ADR-507): the requesting Owner executes their own publishing
 * request with a reason when nobody else can approve it (OwnerOverride, checked again inside the row lock). When it executed, every
 * active Owner and Admin and everyone who approved a request in the last 90 days gets OwnerOverrideMail (SEC-P5-01 c), queued with
 * retries and recorded per recipient (StaffAlerts, SF-5).
 */
final class OverrideApproval
{
    public function __construct(
        private readonly Approvals $approvals,
        private readonly OwnerOverride $policy,
        private readonly StaffAlerts $alerts,
    ) {}

    /**
     * @throws AuthorizationException|OwnerOverrideRefused|ApprovalConflict|ValidationException
     */
    public function handle(ApprovalRequest $request, Staff $owner, string $reason): ApprovalRequest
    {
        $done = $this->approvals->overrideByOwner($request, $owner, $reason, $this->policy);

        if ($done->status === ApprovalStatus::Executed) {
            $at = ($done->executed_at ?? now())->copy()->timezone((string) config('speedclub.notifications.timezone', 'Europe/Berlin'))->format('d.m.Y H:i');

            $this->alerts->queue(StaffAlertKind::OwnerOverride, (string) $done->getKey(), StaffAlerts::overrideAudience(), [
                'actor' => (string) $owner->name,
                'action' => $done->action,
                'reason' => (string) $done->decision_comment,
                'at' => $at,
            ]);
        }

        return $done;
    }
}
