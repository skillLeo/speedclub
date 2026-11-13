<?php

namespace App\Http\Requests\Api\V1\Security;

use Illuminate\Foundation\Http\FormRequest;

class RenamePasskeyRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:'.config()->integer('speedclub.passkeys.name_max_length')],
        ];
    }
}
