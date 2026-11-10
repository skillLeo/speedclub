<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Rules\DeliverableEmail;

/** ADM-10 "E-Mail ändern" (recent password): the new address, the checkbox "Identität geprüft" and a reason. */
class ChangeMemberEmailRequest extends ReasonRequest
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
            'email' => ['bail', 'required', 'string', 'max:255', 'email:rfc', new DeliverableEmail],
            'identity_verified' => ['accepted'],
        ];
    }
}
