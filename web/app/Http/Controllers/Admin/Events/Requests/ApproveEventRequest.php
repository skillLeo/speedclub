<?php

namespace App\Http\Controllers\Admin\Events\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-53 approve and reopen ("a" and undo in the SplitQueue): moderation.decide; the reason is optional (audit only); the version the
 * staff member saw is required (EventVersion).
 */
class ApproveEventRequest extends ReasonRequest
{
    use EventVersion;

    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:1000'],
            // Security review SEC-412-01: the `version` prop of the row or record the staff member decided on.
            ...$this->versionRules(),
        ];
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
