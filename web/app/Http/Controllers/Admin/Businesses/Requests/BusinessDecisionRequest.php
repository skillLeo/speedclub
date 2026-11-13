<?php

namespace App\Http\Controllers\Admin\Businesses\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-55/56 reject, suspend and reinstate: moderation.decide, a reason (10–1000 characters) the owner reads (rejection, suspension) and
 * that goes into the audit event, and the `version` the staff member decided on (optimistic locking).
 */
class BusinessDecisionRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['version' => ['required', 'string', 'max:40']];
    }

    public function version(): string
    {
        return trim($this->string('version')->value());
    }
}
