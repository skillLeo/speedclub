<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Password and a second factor (SET-05 off, new recovery codes): a six-digit authenticator code or a recovery code ("ABCDE-FGHJK").
 */
class SecondFactorRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
            'code' => ['required', 'string', 'max:32'],
        ];
    }
}
