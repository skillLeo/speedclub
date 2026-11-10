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
use App\Services\Team\RolePins;
use App\Services\Team\RoleSets;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-40 role assignment (`staff.manage`, m3.6 §1, 06 §2):
 * - nobody changes their own roles to more atoms or to Owner (self_elevation); stepping down is allowed;
 * - only an Owner changes the roles of an Owner or grants Owner (owner_only);
 * - nobody grants atoms they do not hold (atoms_not_held);
 * - a change that grants Owner/Admin or a four-eyes atom of PermissionMatrix::SENSITIVE (also through a custom role, SF-2), that takes
 *   Admin away (SF-6), and any change to an Owner's roles, is four-eyes `staff.role_elevation` (an Owner approves when Owner is granted
 *   or an Owner is changed); the reason is required then;
 * - the Owner maximum and the last active Owner hold under OwnerRules' lock.
 * Other changes apply at once, audited with the atom diff.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class ChangeStaffRoles
{
    public function __construct(private readonly OwnerRules $owners, private readonly Approvals $approvals) {}

    /**
     * @param  array<array-key, mixed>  $roles  the full new role set
     */
    public function handle(Staff $by, Staff $target, array $roles, ?string $reason = null): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.manage');
        self::ensureEditable($target);

        $after = RoleSets::validate($roles, allowEmpty: true);
        $before = RoleSets::of($target);

        if ($after === $before) {
            throw new TeamRefused('unchanged');
        }

        self::ensureMayChange($by, $target, $before, $after);

        if (RoleSets::elevates($before, $after) || RoleSets::touchesOwner($before, $after) || RoleSets::demotesAdmin($before, $after)) {
            return TeamOutcome::approval($this->approvals->request('staff.role_elevation', [
                'staff_id' => $target->getKey(),
                'roles' => $after,
                'before' => $before,
                // SEC-P3-13: every role named, by id with its atoms and holders; checked again at execution.
                'role_pins' => RolePins::pin([...$after, ...$before]),
            ], (string) $reason, $by, $target));
        }

        $reason = Reason::optional($reason);
        DB::transaction(fn () => $this->apply($target, $before, $after, $reason, $by, null));

        return TeamOutcome::applied();
    }

    /**
     * The executor of the four-eyes `staff.role_elevation`: only while Approvals::approve() runs that request (FourEyes), for the staff
     * member and the role sets it names. The rules are checked again with the requester as the one who changes.
     *
     * @throws AuthorizationException|TeamRefused
     */
    public function applyApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['staff.role_elevation'], $requester, $approver, 'staff.manage');

        $target = Staff::query()->findOrFail((int) $request->payload['staff_id']);
        self::ensureEditable($target);
        /** @var list<string> $after */
        $after = $request->payload['roles'];
        $before = RoleSets::of($target);

        if ($before !== $request->payload['before']) {
            throw new TeamRefused('unchanged');
        }

        // Every role named still has the id and the atoms the approver saw (a rename into the name or an atom edit refuses).
        RolePins::check($request->payload['role_pins'] ?? null, [...$after, ...$before], holders: false);

        self::ensureMayChange($requester, $target, $before, $after);

        // An Owner approver where Owner is granted or an Owner is changed: StaffRoleElevation::requiresOwner(), checked by the engine.
        $this->apply($target, $before, $after, $request->reason, $requester, $approver);
    }

    /**
     * @throws TeamRefused
     */
    public static function ensureEditable(Staff $target): void
    {
        if ($target->anonymised_at !== null) {
            throw new TeamRefused('deleted');
        }

        if ($target->status === StaffStatus::Deactivated) {
            throw new TeamRefused('deactivated');
        }
    }

    /**
     * @param  list<string>  $before
     * @param  list<string>  $after
     *
     * @throws TeamRefused
     */
    private static function ensureMayChange(Staff $by, Staff $target, array $before, array $after): void
    {
        $added = array_diff(RoleSets::atomsOf($after), RoleSets::atomsOf($before));

        // An Owner may step down to Admin (no new atoms); nobody adds an atom or the Owner role to their own account.
        if ($by->getKey() === $target->getKey() && ($added !== [] || (in_array('owner', $after, true) && ! in_array('owner', $before, true)))) {
            throw new TeamRefused('self_elevation');
        }

        if (RoleSets::touchesOwner($before, $after) && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        RoleSets::ensureHolds($by, array_values($added));
    }

    /**
     * @param  list<string>  $before
     * @param  list<string>  $after
     */
    private function apply(Staff $target, array $before, array $after, ?string $reason, Staff $requester, ?Staff $approver): void
    {
        if (RoleSets::touchesOwner($before, $after)) {
            $owners = $this->owners->lock();

            if (in_array('owner', $after, true) && ! in_array('owner', $before, true)) {
                $this->owners->ensureRoomFor($owners, $target);
            }

            if (in_array('owner', $before, true) && ! in_array('owner', $after, true)) {
                $this->owners->ensureNotLastActive($owners, $target);
            }
        }

        $atomsBefore = RoleSets::atomsOf($before);
        $atomsAfter = RoleSets::atomsOf($after);
        $target->syncRoles($after);

        Audit::record(TeamEvent::RolesChanged->value, $target,
            before: ['roles' => $before],
            after: [
                'roles' => $after,
                'atoms_added' => array_values(array_diff($atomsAfter, $atomsBefore)),
                'atoms_removed' => array_values(array_diff($atomsBefore, $atomsAfter)),
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
            ],
            reason: $reason, actor: $approver ?? $requester);
    }
}
