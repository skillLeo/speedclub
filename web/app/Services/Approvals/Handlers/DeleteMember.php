<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Members\DeleteMemberAsStaff;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAMember;
use App\Services\Approvals\FourEyes;

/**
 * members.delete (06_ADMIN_SPEC §2 four-eyes list, ADM-10): payload {member_id}, subject the member. Executes DeleteMemberAsStaff (the
 * SET-13 closure, hard delete within 30 days).
 */
final class DeleteMember implements ApprovalHandler
{
    use NamesAMember;

    public function __construct(private readonly DeleteMemberAsStaff $delete) {}

    public function key(): string
    {
        return 'members.delete';
    }

    public function atom(): string
    {
        return 'members.delete';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        $this->validateMember($payload);
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.members_delete.title',
            'subject_label' => $this->memberLabel($payload),
            'lines' => [['label' => 'approvals.members_delete.status', 'before' => 'active', 'after' => 'deactivated']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'members.delete');
        $member = $this->validateMember($request->payload);
        $this->delete->handle($this->requester($request), $approver, $member, $request->reason);

        return ['member_id' => $member->id];
    }
}
