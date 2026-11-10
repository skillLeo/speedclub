<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-10 "Ansicht als" (m3.2-contract §3): reason, and the member's consent (required of Support, StartViewAs checks it). */
class StartViewAsRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.view_as';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['member_consented' => ['sometimes', 'boolean']];
    }
}
