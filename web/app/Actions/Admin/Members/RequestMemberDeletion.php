<?php

namespace App\Actions\Admin\Members;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

/**
 * ADM-10 "Löschen" (`members.delete`, four-eyes; the controller checks the typed "LÖSCHEN"): asks for the approval of
 * `members.delete`; on approval DeleteMemberAsStaff closes the account. Never executes here.
 *
 * @throws AuthorizationException|ValidationException|DomainException when the deletion is already under way
 */
class RequestMemberDeletion
{
    public function __construct(private readonly Approvals $approvals) {}

    public function handle(Staff $staff, User $member, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.delete');

        if ($member->trashed() || $member->isPendingDeletion()) {
            throw new DomainException('This account is being deleted already.');
        }

        return $this->approvals->request('members.delete', ['member_id' => $member->id], $reason, $staff, $member);
    }
}
