<?php

namespace App\Http\Requests\Api\V1\Auth;

use App\Http\Requests\Api\V1\Auth\Concerns\NormalizesEmail;
use App\Http\Requests\Api\V1\Auth\Concerns\SignsIn;
use Illuminate\Foundation\Http\FormRequest;

class LoginRequest extends FormRequest
{
    use NormalizesEmail, SignsIn;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc'],
            'password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
            ...$this->deviceRules(),
        ];
    }
}
