<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;

/**
 * AUTH-16: the attempt_id of the link_required answer and the 6-digit code mailed to the existing account.
 */
class ConfirmLinkRequest extends FormRequest
{
    use SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'attempt_id' => ['required', 'string', 'regex:'.StartEmailCodeRequest::ATTEMPT_PATTERN],
            'code' => ['required', 'string', 'digits:'.config()->integer('speedclub.email_code.code_length')],
            ...$this->deviceRules(),
        ];
    }
}
