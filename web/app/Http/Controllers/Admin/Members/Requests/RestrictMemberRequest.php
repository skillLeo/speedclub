<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;
use Illuminate\Validation\Rule;

/** ADM-10 "Einschränken" (recent password): messaging or publishing, an end or none, the statement of reasons and a reason. */
class RestrictMemberRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.restrict';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'type' => ['required', Rule::enum(RestrictionType::class)],
            'until' => ['nullable', 'date', 'after:now'],
            ...Statement::rules(),
        ];
    }
}
