<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Löschen" (four-eyes, typed confirmation). */
class DeleteMemberRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.delete';
    }

    /**
     * The typed confirmation of an irreversible action (ConfirmDialog `typed`): the word of the staff member's language.
     *
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['confirm' => ['required', 'string', 'in:LÖSCHEN,DELETE']];
    }
}
