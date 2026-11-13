<?php

namespace App\Http\Requests\Api\V1\Security;

use App\Http\Requests\Api\V1\Auth\StartEmailCodeRequest;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST me/reauth/email: the attempt id the app made for this code (as at sign-in).
 */
class AttemptRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'attempt_id' => ['required', 'string', 'regex:'.StartEmailCodeRequest::ATTEMPT_PATTERN],
        ];
    }
}
