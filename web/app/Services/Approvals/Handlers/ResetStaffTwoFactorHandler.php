<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Team\ResetStaffTwoFactor;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\FourEyes;
use Illuminate\Validation\ValidationException;

/**
 * staff.reset_two_factor (ADR-238, lost authenticator): payload {staff_id} of an active staff member with confirmed TOTP, subject that
 * staff member. Asked by an Owner (ResetStaffTwoFactor), approved by another Owner who is not the staff member it is about (ADR-237).
 * Executes ResetStaffTwoFactor::resetApproved().
 */
final class ResetStaffTwoFactorHandler implements ApprovalHandler
{
    use NamesAStaffMember;

    public function __construct(private readonly ResetStaffTwoFactor $reset) {}

    public function key(): string
    {
        return 'staff.reset_two_factor';
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
        $staff = $this->validateStaff($payload, StaffStatus::Active);

        if (! $staff->hasEnabledTwoFactorAuthentication()) {
            throw ValidationException::withMessages(['staff_id' => [(string) __('team.refused.no_two_factor')]]);
        }
    }

    public function describe(array $payload): array
    {
        return [
            'title' => 'approvals.staff_reset_two_factor.title',
            'subject_label' => $this->staffLabel($payload),
            'lines' => [['label' => 'approvals.staff_reset_two_factor.two_factor', 'before' => 'confirmed', 'after' => 'enrolment_required']],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'staff.reset_two_factor');
        $this->reset->resetApproved($request, $this->requesterOf($request), $approver);

        return ['staff_id' => (int) $request->payload['staff_id']];
    }
}
