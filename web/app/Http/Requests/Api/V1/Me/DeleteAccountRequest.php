<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Http\Requests\Api\V1\Me\Concerns\ProvesPassword;
use Illuminate\Foundation\Http\FormRequest;

/**
 * SET-13. `code` (authenticator or recovery code) is needed when two-factor is on; without it the answer is 422 on `code`.
 */
class DeleteAccountRequest extends FormRequest
{
    use ProvesPassword;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => $this->passwordRule(),
            'code' => ['nullable', 'string', 'max:32'],
        ];
    }
}
