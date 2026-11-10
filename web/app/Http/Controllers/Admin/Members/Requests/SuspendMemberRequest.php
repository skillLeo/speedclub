<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;

/** ADM-10 "Sperren" (four-eyes, recent password; moderators at most 30 days, RequestMemberSuspension). */
class SuspendMemberRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.suspend';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['until' => ['nullable', 'date', 'after:now'], ...Statement::rules()];
    }
}
