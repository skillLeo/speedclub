<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ChecksPayloadAtoms;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\FourEyes;
use App\Services\Team\RoleSets;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * staff.role_elevation (06 §2 "role change that grants Admin/Owner or roles.manage", A4; m3.6 §1; a four-eyes atom through a custom role,
 * SF-2; taking Admin away, SF-6): payload {staff_id, roles, before},
 * both full role sets, sorted. Requester and approver hold `staff.manage` and `roles.manage`; an Owner approves when Owner is granted or an
 * Owner's roles change. At approval the staff member must still hold `before`. Executes ChangeStaffRoles::applyApproved().
 */
final class StaffRoleElevation implements ApprovalHandler, ChecksPayloadAtoms
{
    use NamesAStaffMember;

    public function __construct(private readonly ChangeStaffRoles $change) {}

    public function key(): string
    {
        return 'staff.role_elevation';
    }

    public function atom(): string
    {
        return 'staff.manage';
    }

    /**
     * `roles.manage`, and every four-eyes atom the change grants (SF-2): nobody approves handing out an atom they do not hold.
     */
    public function atomsFor(array $payload): array
    {
        $roles = is_array($payload['roles'] ?? null) ? array_values(array_map(strval(...), $payload['roles'])) : [];
        $before = is_array($payload['before'] ?? null) ? array_values(array_map(strval(...), $payload['before'])) : [];

        return array_values(array_unique(['roles.manage', ...RoleSets::sensitiveGrants($before, $roles)]));
    }

    public function requiresOwner(array $payload): bool
    {
        $roles = is_array($payload['roles'] ?? null) ? $payload['roles'] : [];
        $before = is_array($payload['before'] ?? null) ? $payload['before'] : [];

        return in_array('owner', $roles, true) || in_array('owner', $before, true) || $this->staffIsOwner($payload);
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, ['roles' => ['present', 'array'], 'before' => ['present', 'array']])->validate();
        $staff = $this->validateStaff($payload, StaffStatus::Active);
        $roles = RoleSets::validate($payload['roles'], allowEmpty: true);

        if ($roles !== $payload['roles'] || RoleSets::of($staff) !== $payload['before']) {
            throw ValidationException::withMessages(['roles' => [(string) __('team.refused.changed')]]);
        }
    }

    public function describe(array $payload): array
    {
        $join = fn (mixed $roles): string => is_array($roles) ? implode(', ', array_map(strval(...), $roles)) : '';

        return [
            'title' => 'approvals.staff_role_elevation.title',
            'subject_label' => $this->staffLabel($payload),
            'lines' => [
                ['label' => 'approvals.staff_role_elevation.roles', 'before' => $join($payload['before'] ?? []), 'after' => $join($payload['roles'] ?? [])],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'staff.role_elevation');
        $this->change->applyApproved($request, $this->requesterOf($request), $approver);

        return ['staff_id' => (int) $request->payload['staff_id'], 'roles' => $request->payload['roles']];
    }
}
