<?php

namespace App\Http\Requests\Api\V1\Auth\Concerns;

/**
 * M5.9d (m5.9d contract §5, §10.4): the optional `invite_code` of the account-creating calls (register, email/verify, apple, google). It
 * is never a reason for a 422: anything that is not a string of at most 32 characters is dropped before validation, and an unknown,
 * used or malformed code is ignored when the account activates (App\Services\Members\MemberActivation).
 */
trait CarriesInviteCode
{
    /**
     * @return array<string, mixed>
     */
    protected function inviteCodeRules(): array
    {
        return [
            // The code of /join/{code} (8 characters Crockford; I/L read as 1, O as 0). Optional; an invalid code is ignored, never refused.
            'invite_code' => ['nullable', 'string'],
        ];
    }

    protected function dropUnusableInviteCode(): void
    {
        $code = $this->input('invite_code');

        if ($this->has('invite_code') && (! is_string($code) || mb_strlen($code) > 32)) {
            $this->merge(['invite_code' => null]);
        }
    }

    protected function prepareForValidation(): void
    {
        $this->dropUnusableInviteCode();
    }

    public function inviteCode(): ?string
    {
        $code = $this->validated('invite_code');

        return is_string($code) && $code !== '' ? $code : null;
    }
}
