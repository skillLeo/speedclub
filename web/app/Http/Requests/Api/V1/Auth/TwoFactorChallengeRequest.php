<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;

/**
 * AUTH-11. Exactly one of `code` (six digits from the authenticator app) and `recovery_code`. The device fields work as at sign-in.
 */
class TwoFactorChallengeRequest extends FormRequest
{
    use SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'challenge' => ['required', 'string', 'size:40', 'alpha_num:ascii'],
            'code' => ['required_without:recovery_code', 'prohibits:recovery_code', 'nullable', 'string', 'digits:6'],
            'recovery_code' => ['required_without:code', 'nullable', 'string', 'max:32'],
            ...$this->deviceRules(),
        ];
    }
}
