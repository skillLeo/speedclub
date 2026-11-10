<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

/**
 * SET-13. `code` (authenticator or recovery code) is needed when two-factor is on; without it the answer is 422 on `code`.
 */
class DeleteAccountRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
            'code' => ['nullable', 'string', 'max:32'],
        ];
    }
}
