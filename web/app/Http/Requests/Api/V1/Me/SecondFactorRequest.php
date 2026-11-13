<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Http\Requests\Api\V1\Me\Concerns\ProvesPassword;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Password and a second factor (SET-05 off, new recovery codes): a six-digit authenticator code or a recovery code ("ABCDE-FGHJK").
 */
class SecondFactorRequest extends FormRequest
{
    use ProvesPassword;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => $this->passwordRule(),
            'code' => ['required', 'string', 'max:32'],
        ];
    }
}
