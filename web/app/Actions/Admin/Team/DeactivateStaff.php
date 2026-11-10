<?php

namespace App\Actions\Admin\Team;

use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Catalog\Reason;
use App\Services\Team\OwnerRules;
use App\Services\Team\StaffInvites;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use App\Support\ViewAs;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-40 "Deaktivieren" (`staff.manage`, with reason; m3.6 §1, 06 §2). Deactivating an Owner or Admin is four-eyes
 * (`staff.deactivate_privileged`; an Owner only by an Owner, approved by an Owner). Nobody deactivates themselves; the last active Owner
 * stays (OwnerRules, under the lock). On execution: status deactivated, every session and the remember token end, the credentials epoch
 * moves, every view-as the staff member started ends (ViewAs::revokeStartedBy, ADR-231), open invite links end. Roles stay, so a
 * reactivation restores the account as it was. Their pending approval requests fail at approval (the requester is no longer active).
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class DeactivateStaff
{
    public function __construct(
        private readonly OwnerRules $owners,
        private readonly Approvals $approvals,
        private readonly StaffSessions $sessions,
        private readonly StaffInvites $invites,
    ) {}

    public function handle(Staff $by, Staff $target, string $reason): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.manage');
        $reason = Reason::required($reason);
        self::ensureMay($by, $target);

        if ($target->isPrivileged()) {
            return TeamOutcome::approval($this->approvals->request('staff.deactivate_privileged', ['staff_id' => $target->getKey()], $reason, $by, $target));
        }

        DB::transaction(fn () => $this->deactivate($target, $reason, $by, null));

        return TeamOutcome::applied();
    }

    /**
     * The executor of `staff.deactivate_privileged`, only inside its approval (FourEyes).
     *
     * @throws AuthorizationException|TeamRefused
     */
    public function deactivateApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['staff.deactivate_privileged'], $requester, $approver, 'staff.manage');
        $target = Staff::query()->findOrFail((int) $request->payload['staff_id']);
        self::ensureMay($requester, $target);

        $this->deactivate($target, $request->reason, $requester, $approver);
    }

    /**
     * @throws TeamRefused
     */
    public static function ensureMay(Staff $by, Staff $target): void
    {
        if ($by->getKey() === $target->getKey()) {
            throw new TeamRefused('self');
        }

        ChangeStaffRoles::ensureEditable($target);

        if ($target->isOwner() && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }
    }

    private function deactivate(Staff $target, string $reason, Staff $requester, ?Staff $approver): void
    {
        if ($target->isOwner()) {
            $this->owners->ensureNotLastActive($this->owners->lock(), $target);
        }

        $locked = Staff::query()->whereKey($target->getKey())->lockForUpdate()->firstOrFail();
        $before = $locked->status;
        $locked->forceFill(['status' => StaffStatus::Deactivated, 'deactivated_at' => now()])->save();

        // First, so the view-as tokens end with this reason rather than the epoch's.
        $viewAs = ViewAs::revokeStartedBy($locked, 'staff_inactive');
        StaffCredentials::rotate($locked);
        $sessions = $this->sessions->deleteAll($locked);
        $links = $this->invites->revokeAll($locked);

        Audit::record(TeamEvent::Deactivated->value, $locked,
            before: ['status' => $before->value],
            after: [
                'status' => StaffStatus::Deactivated->value,
                'sessions_ended' => $sessions,
                'view_as_ended' => $viewAs,
                'invites_ended' => $links,
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
            ],
            reason: $reason, actor: $approver ?? $requester);
    }
}
