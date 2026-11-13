<?php

namespace App\Http\Requests\Api\V1\Security;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST me/security/secure (SET-21 "Das war ich nicht"): optionally the row that was not the member.
 */
class SecureAccountRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The SET-21 row the member did not do; it goes into the support request. */
            'security_event_id' => ['nullable', 'string', 'ulid'],
        ];
    }
}
