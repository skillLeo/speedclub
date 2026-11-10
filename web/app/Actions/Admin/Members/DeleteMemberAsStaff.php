<?php

namespace App\Actions\Admin\Members;

use App\Actions\Account\DeleteAccount;
use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The executor of the four-eyes `members.delete` (and of a `members.bulk` delete), refused unless Approvals::approve() is executing
 * such a request naming this member (FourEyes, MF-1): the same closure as SET-13
 * (DeleteAccount: deactivated at once, QR codes revoked, every sign-in ended, photos withdrawn, the member mailed, accounts:prune
 * hard-deletes within 30 days). DeleteAccount audits member.deletion_requested; this adds `member.deleted_by_staff` naming requester
 * and approver, so the log says who did it.
 *
 * @throws AuthorizationException|DomainException
 */
class DeleteMemberAsStaff
{
    public function __construct(private readonly DeleteAccount $delete) {}

    public function handle(Staff $requester, Staff $approver, User $member, string $reason): void
    {
        FourEyes::member(FourEyes::executor(['members.delete', 'members.bulk'], $requester, $approver, 'members.delete'), $member, 'delete');

        if ($member->trashed() || $member->isPendingDeletion()) {
            throw new DomainException('This account is being deleted already.');
        }

        $this->delete->handle($member);

        DB::transaction(function () use ($requester, $approver, $member, $reason): void {
            Audit::record(AdminMemberEvent::DeletedByStaff->value, $member, after: [
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver->getKey(),
            ], reason: $reason, actor: $approver);
        });
    }
}
