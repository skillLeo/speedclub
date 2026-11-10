<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Members\ResetMemberTwoFactor as ResetAction;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAMember;
use App\Services\Approvals\FourEyes;
use Illuminate\Validation\ValidationException;

/**
 * members.reset_2fa (06_ADMIN_SPEC §2 four-eyes list, ADM-10): payload {member_id}, subject the member. Executes ResetMemberTwoFactor.
 */
final class ResetMemberTwoFactor implements ApprovalHandler
{
    use NamesAMember;

    public function __construct(private readonly ResetAction $reset) {}

    public function key(): string
    {
        return 'members.reset_2fa';
    }

    public function atom(): string
    {
        return 'members.reset_2fa';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        $member = $this->validateMember($payload);

        if (! $member->hasTwoFactor() && ! $member->hasLockedSecondFactor()) {
            throw ValidationException::withMessages(['member_id' => ['Two-factor protection is off for this account.']]);
        }
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.members_reset_2fa.title',
            'subject_label' => $this->memberLabel($payload),
            'lines' => [['label' => 'approvals.members_reset_2fa.two_factor', 'before' => 'on', 'after' => 'off']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'members.reset_2fa');
        $member = $this->validateMember($request->payload);
        $this->reset->handle($this->requester($request), $approver, $member, $request->reason);

        return ['member_id' => $member->id];
    }
}
