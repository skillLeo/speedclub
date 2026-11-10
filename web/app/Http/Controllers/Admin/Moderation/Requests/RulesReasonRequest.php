<?php

namespace App\Http\Controllers\Admin\Moderation\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-23 remove a term / publish rate-limit overrides (`moderation.rules`, recent password, reason). */
class RulesReasonRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.rules';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['overrides' => ['sometimes', 'array']];
    }
}
