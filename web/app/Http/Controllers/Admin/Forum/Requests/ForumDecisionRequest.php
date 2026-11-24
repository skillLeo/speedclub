<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * Pre-moderation approve (reason optional) and reject (reason 10–1000 characters, the author reads it): moderation.decide and the
 * `version` of the row the staff member decided on (optimistic locking, ADR-439).
 */
class ForumDecisionRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $reject = str_ends_with((string) $this->route()?->getName(), '.reject');

        return [
            'reason' => [$reject ? 'required' : 'nullable', 'string', $reject ? 'min:10' : 'min:0', 'max:1000'],
            'version' => ['required', 'string', 'max:80'],
        ];
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }

    public function version(): string
    {
        return $this->string('version')->value();
    }
}
