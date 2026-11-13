<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Http\Requests\Api\V1\Me\Concerns\ProvesPassword;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The current password again (SET-05 start, SET-12).
 */
class PasswordRequest extends FormRequest
{
    use ProvesPassword;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => $this->passwordRule(),
        ];
    }
}
