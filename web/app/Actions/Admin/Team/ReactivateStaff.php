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
use App\Services\Catalog\Reason;
use App\Services\Team\OwnerRules;
use App\Services\Team\RoleSets;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-40 "Reaktivieren" (`staff.manage`, with reason): the account comes back with its roles, password and TOTP; its old sessions ended
 * with the deactivation. Only someone holding every atom of the account revives it (no Support member revives an Admin). An Owner only
 * by an Owner, and four-eyes `staff.reactivate_owner` approved by a second Owner (SF-6 of the M3.4-batch review: inviting or promoting an
 * Owner is four-eyes, so bringing one back is too), within the Owner maximum (OwnerRules, under the lock). A deleted account stays
 * deleted.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class ReactivateStaff
{
    public function __construct(private readonly OwnerRules $owners, private readonly Approvals $approvals) {}

    public function handle(Staff $by, Staff $target, string $reason): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.manage');
        $reason = Reason::required($reason);
        self::ensureMay($by, $target);

        if ($target->isOwner()) {
            return TeamOutcome::approval($this->approvals->request('staff.reactivate_owner', ['staff_id' => $target->getKey()], $reason, $by, $target));
        }

        DB::transaction(fn () => $this->reactivate($target, $reason, $by, null));

        return TeamOutcome::applied();
    }

    /**
     * The executor of `staff.reactivate_owner`, only inside its approval (FourEyes), asked and approved by Owners.
     *
     * @throws AuthorizationException|TeamRefused
     */
    public function reactivateApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['staff.reactivate_owner'], $requester, $approver, 'staff.manage');

        if (! $requester->isOwner() || ! $approver->isOwner()) {
            throw new AuthorizationException;
        }

        $target = Staff::query()->findOrFail((int) $request->payload['staff_id']);
        self::ensureMay($requester, $target);

        $this->reactivate($target, $request->reason, $requester, $approver);
    }

    /**
     * @throws TeamRefused
     */
    public static function ensureMay(Staff $by, Staff $target): void
    {
        if ($target->anonymised_at !== null) {
            throw new TeamRefused('deleted');
        }

        if ($target->status !== StaffStatus::Deactivated) {
            throw new TeamRefused('not_deactivated');
        }

        if ($target->isOwner() && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        RoleSets::ensureHolds($by, RoleSets::atomsOf(RoleSets::of($target)));
    }

    private function reactivate(Staff $target, string $reason, Staff $requester, ?Staff $approver): void
    {
        if ($target->isOwner()) {
            $this->owners->ensureRoomFor($this->owners->lock(), $target);
        }

        $locked = Staff::query()->whereKey($target->getKey())->lockForUpdate()->firstOrFail();

        if ($locked->status !== StaffStatus::Deactivated) {
            throw new TeamRefused('not_deactivated');
        }

        $locked->forceFill(['status' => StaffStatus::Active, 'deactivated_at' => null])->save();

        Audit::record(TeamEvent::Reactivated->value, $locked,
            before: ['status' => StaffStatus::Deactivated->value],
            after: ['status' => StaffStatus::Active->value, 'requested_by' => $requester->getKey(), 'approved_by' => $approver?->getKey()],
            reason: $reason, actor: $approver ?? $requester);
    }
}
