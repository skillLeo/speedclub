<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The current password again (SET-05 start, SET-12).
 */
class PasswordRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
        ];
    }
}
