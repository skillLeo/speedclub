<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\ReactivateStaff;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\FourEyes;

/**
 * staff.reactivate_owner (SF-6 of the M3.4-batch review; m3.6 §1 "only an Owner can … an Owner, and that is four-eyes with a second Owner
 * as approver"): payload {staff_id} of a deactivated Owner; asked and approved by Owners. Executes ReactivateStaff::reactivateApproved()
 * (the Owner maximum checked again under the lock).
 */
final class ReactivateOwnerStaff implements ApprovalHandler
{
    use NamesAStaffMember;

    public function __construct(private readonly ReactivateStaff $reactivate) {}

    public function key(): string
    {
        return 'staff.reactivate_owner';
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
            'title' => 'approvals.staff_reactivate_owner.title',
            'subject_label' => $this->staffLabel($payload),
            'lines' => [['label' => 'approvals.staff_reactivate_owner.status', 'before' => 'deactivated', 'after' => 'active']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'staff.reactivate_owner');
        $this->reactivate->reactivateApproved($request, $this->requesterOf($request), $approver);

        return ['staff_id' => (int) $request->payload['staff_id']];
    }
}
