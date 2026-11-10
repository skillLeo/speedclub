<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Rules\MemberPassword;
use Illuminate\Foundation\Http\FormRequest;

class ResetPasswordRequest extends FormRequest
{
    use NormalizesEmail;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'code' => ['required', 'string', 'digits:'.config()->integer('speedclub.verification.code_length')],
            'password' => ['required', 'string', new MemberPassword($this->email())],
        ];
    }
}
