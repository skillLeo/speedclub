<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Rules\ValidUsername;
use Illuminate\Foundation\Http\FormRequest;

class UpdateUsernameRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'max:255', new ValidUsername],
        ];
    }
}
