<?php

namespace App\Services\Approvals\Concerns;

use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * For the M3.6 Team handlers whose payload names a staff member as {staff_id}.
 */
trait NamesAStaffMember
{
    /**
     * @param  array<string, mixed>  $payload
     *
     * @throws ValidationException
     */
    protected function validateStaff(array $payload, ?StaffStatus $status = null): Staff
    {
        Validator::make($payload, ['staff_id' => ['required', 'integer']])->validate();
        $staff = Staff::query()->find((int) $payload['staff_id']);

        if (! $staff instanceof Staff || $staff->anonymised_at !== null) {
            throw ValidationException::withMessages(['staff_id' => [(string) __('team.refused.deleted')]]);
        }

        if ($status !== null && $staff->status !== $status) {
            throw ValidationException::withMessages(['staff_id' => [(string) __($status === StaffStatus::Deactivated ? 'team.refused.not_deactivated' : 'team.refused.deactivated')]]);
        }

        return $staff;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function staffLabel(array $payload): ?string
    {
        $staff = is_numeric($payload['staff_id'] ?? null) ? Staff::query()->find((int) $payload['staff_id']) : null;

        return $staff?->name;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function staffIsOwner(array $payload): bool
    {
        $staff = is_numeric($payload['staff_id'] ?? null) ? Staff::query()->find((int) $payload['staff_id']) : null;

        return $staff?->isOwner() ?? false;
    }

    protected function requesterOf(ApprovalRequest $request): Staff
    {
        return Staff::query()->findOrFail($request->requested_by);
    }
}
