<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\DeactivateStaff;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\FourEyes;

/**
 * staff.deactivate_privileged (06 §2 "deactivating an Owner/Admin"): payload {staff_id}, subject the staff member. An Owner approves
 * when the account is an Owner's. Executes DeactivateStaff::deactivateApproved() (last active Owner checked again under the lock).
 */
final class DeactivatePrivilegedStaff implements ApprovalHandler
{
    use NamesAStaffMember;

    public function __construct(private readonly DeactivateStaff $deactivate) {}

    public function key(): string
    {
        return 'staff.deactivate_privileged';
    }

    public function atom(): string
    {
        return 'staff.manage';
    }

    public function requiresOwner(array $payload): bool
    {
        return $this->staffIsOwner($payload);
    }

    public function validate(array $payload): void
    {
        $this->validateStaff($payload, StaffStatus::Active);
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.staff_deactivate_privileged.title',
            'subject_label' => $this->staffLabel($payload),
            'lines' => [['label' => 'approvals.staff_deactivate_privileged.status', 'before' => 'active', 'after' => 'deactivated']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'staff.deactivate_privileged');
        $this->deactivate->deactivateApproved($request, $this->requesterOf($request), $approver);

        return ['staff_id' => (int) $request->payload['staff_id']];
    }
}
