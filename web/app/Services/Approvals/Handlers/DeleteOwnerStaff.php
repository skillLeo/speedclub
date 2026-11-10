<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\DeleteStaff;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\FourEyes;

/**
 * staff.delete_owner (06 §2: an Owner "cannot be deleted by anyone but another Owner (four-eyes)"): payload {staff_id} of a deactivated
 * Owner; asked and approved by Owners. Executes DeleteStaff::deleteApproved().
 */
final class DeleteOwnerStaff implements ApprovalHandler
{
    use NamesAStaffMember;

    public function __construct(private readonly DeleteStaff $delete) {}

    public function key(): string
    {
        return 'staff.delete_owner';
    }

    public function atom(): string
    {
        return 'staff.manage';
    }

    public function requiresOwner(array $payload): bool
    {
        return true;
    }

    public function validate(array $payload): void
    {
        $this->validateStaff($payload, StaffStatus::Deactivated);
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.staff_delete_owner.title',
            'subject_label' => $this->staffLabel($payload),
            'lines' => [['label' => 'approvals.staff_delete_owner.account', 'before' => 'deactivated', 'after' => 'deleted']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'staff.delete_owner');
        $this->delete->deleteApproved($request, $this->requesterOf($request), $approver);

        return ['staff_id' => (int) $request->payload['staff_id']];
    }
}
