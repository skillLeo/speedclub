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
use App\Services\Team\RoleSets;
use App\Services\Team\StaffInvites;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-40 "Löschen" (`staff.manage`, with reason, irreversible; the page asks for the typed "LÖSCHEN"). Only a deactivated account
 * (the deactivation already carried the four-eyes of a privileged one). The row stays, because the audit log names it (StaffStatus):
 * name, address, password, second factor, roles and invite links go; the account can never sign in again. Deleting an Owner is
 * four-eyes `staff.delete_owner`, asked and approved by Owners (06 §2: "cannot be deleted by anyone but another Owner").
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class DeleteStaff
{
    public const NAME = 'Gelöschtes Teammitglied';

    public function __construct(
        private readonly Approvals $approvals,
        private readonly StaffSessions $sessions,
        private readonly StaffInvites $invites,
    ) {}

    public function handle(Staff $by, Staff $target, string $reason): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.manage');
        $reason = Reason::required($reason);
        self::ensureMay($by, $target);

        if ($target->isOwner()) {
            return TeamOutcome::approval($this->approvals->request('staff.delete_owner', ['staff_id' => $target->getKey()], $reason, $by, $target));
        }

        DB::transaction(fn () => $this->anonymise($target, $reason, $by, null));

        return TeamOutcome::applied();
    }

    /**
     * The executor of `staff.delete_owner`, only inside its approval (FourEyes).
     *
     * @throws AuthorizationException|TeamRefused
     */
    public function deleteApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['staff.delete_owner'], $requester, $approver, 'staff.manage');

        if (! $requester->isOwner() || ! $approver->isOwner()) {
            throw new AuthorizationException;
        }

        $target = Staff::query()->findOrFail((int) $request->payload['staff_id']);
        self::ensureMay($requester, $target);

        $this->anonymise($target, $request->reason, $requester, $approver);
    }

    /**
     * @throws TeamRefused
     */
    public static function ensureMay(Staff $by, Staff $target): void
    {
        if ($by->getKey() === $target->getKey()) {
            throw new TeamRefused('self');
        }

        if ($target->anonymised_at !== null) {
            throw new TeamRefused('deleted');
        }

        if ($target->status !== StaffStatus::Deactivated) {
            throw new TeamRefused('not_deactivated');
        }

        if ($target->isOwner() && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }
    }

    private function anonymise(Staff $target, string $reason, Staff $requester, ?Staff $approver): void
    {
        $locked = Staff::query()->whereKey($target->getKey())->lockForUpdate()->firstOrFail();
        $roles = RoleSets::of($locked);

        $locked->forceFill([
            'name' => self::NAME,
            'email' => 'deleted-'.$locked->getKey().'-'.Str::lower(Str::random(8)).'@staff.invalid',
            'password' => Str::password(40),
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_pending_secret' => null,
            'two_factor_pending_session' => null,
            'two_factor_pending_at' => null,
            'password_proof_required' => false,
            'anonymised_at' => now(),
        ])->save();
        $locked->syncRoles([]);
        $locked->syncPermissions([]);

        StaffCredentials::rotate($locked);
        $this->sessions->deleteAll($locked);
        $this->invites->revokeAll($locked);

        Audit::record(TeamEvent::Deleted->value, $locked,
            before: ['roles' => $roles],
            after: ['requested_by' => $requester->getKey(), 'approved_by' => $approver?->getKey()],
            reason: $reason, actor: $approver ?? $requester);
    }
}
