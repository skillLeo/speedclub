<?php

namespace App\Http\Controllers\Admin\Events\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/**
 * ADM-53/54 reject and cancel: moderation.decide and a reason (10–1000 characters) that the organiser reads (rejection) or every attendee
 * reads (cancellation), and that goes into the audit event; the version the staff member saw (EventVersion).
 */
class DecideEventRequest extends ReasonRequest
{
    use EventVersion;

    /** ADR-540: the organiser and the attendees read the rejection or cancellation text, so it stays required. */
    protected function reasonRequired(): bool
    {
        return true;
    }

    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return $this->versionRules();
    }
}
