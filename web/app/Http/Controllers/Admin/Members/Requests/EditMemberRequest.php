<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Rules\ValidUsername;

/** ADM-10 edit drawer (recent password): display name, bio, city, username; never the password. */
class EditMemberRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.edit';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'display_name' => ['sometimes', 'nullable', 'string', 'max:60'],
            'city' => ['sometimes', 'nullable', 'string', 'max:100'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:500'],
            'username' => ['sometimes', 'string', 'max:255', new ValidUsername],
        ];
    }
}
