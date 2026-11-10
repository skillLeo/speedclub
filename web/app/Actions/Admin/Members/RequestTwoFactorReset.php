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
 * ADM-10 "2FA zurücksetzen" (`members.reset_2fa`, four-eyes, recent password): asks for the approval of `members.reset_2fa`; the
 * handler runs ResetMemberTwoFactor. Never executes here.
 *
 * @throws AuthorizationException|ValidationException|DomainException when two-factor is off
 */
class RequestTwoFactorReset
{
    public function __construct(private readonly Approvals $approvals) {}

    public function handle(Staff $staff, User $member, string $reason): ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'members.reset_2fa');

        if (! $member->hasTwoFactor() && ! $member->hasLockedSecondFactor()) {
            throw new DomainException('Two-factor protection is off for this account.');
        }

        return $this->approvals->request('members.reset_2fa', ['member_id' => $member->id], $reason, $staff, $member);
    }
}
