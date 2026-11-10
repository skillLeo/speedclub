<?php

namespace App\Services\Approvals\Concerns;

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * For four-eyes handlers whose payload is {member_id} (M3.2): validation, the member, the requester and the summary's subject label.
 */
trait NamesAMember
{
    /**
     * @param  array<string, mixed>  $payload
     *
     * @throws ValidationException
     */
    protected function validateMember(array $payload, bool $allowClosed = false): User
    {
        Validator::make($payload, ['member_id' => ['required', 'string', 'size:26']])->validate();

        $member = User::query()->find($payload['member_id']);

        if (! $member instanceof User || (! $allowClosed && $member->isPendingDeletion())) {
            throw ValidationException::withMessages(['member_id' => ['There is no such account.']]);
        }

        return $member;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function memberLabel(array $payload): ?string
    {
        $id = $payload['member_id'] ?? null;
        $member = is_string($id) ? User::withTrashed()->find($id) : null;

        return $member?->username === null ? null : '@'.$member->username;
    }

    protected function requester(ApprovalRequest $request): Staff
    {
        return Staff::query()->findOrFail($request->requested_by);
    }
}
