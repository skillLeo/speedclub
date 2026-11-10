<?php

namespace App\Actions\Admin\Members;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-10 "Export" (`members.export`, four-eyes): asks for the approval of `members.export`; on approval ExportMemberData queues the
 * SET-12 export ZIP for the requester. Never executes here.
 *
 * @throws AuthorizationException|ValidationException
 */
class RequestMemberExport
{
    public function __construct(private readonly Approvals $approvals) {}

    public function handle(Staff $staff, User $member, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.export');

        return $this->approvals->request('members.export', ['member_id' => $member->id], $reason, $staff, $member);
    }
}
