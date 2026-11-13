<?php

namespace App\Http\Controllers\Admin\Businesses\Requests;

/**
 * ADM-55 verify and reopen ("a" and undo in the SplitQueue): moderation.decide; the reason is optional (audit only); the version is
 * required.
 */
class BusinessApproveRequest extends BusinessDecisionRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['nullable', 'string', 'max:1000'], ...$this->extraRules()];
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
