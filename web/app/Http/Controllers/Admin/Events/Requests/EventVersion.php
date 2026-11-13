<?php

namespace App\Http\Controllers\Admin\Events\Requests;

/**
 * Optimistic locking of ADM-53/54 (ADR-439, M4.17): every staff write on an event posts the `version` prop of the row or record it was
 * decided on (ReviewEvent::version). A changed event answers 409 edit_conflict instead of acting on what staff did not see.
 */
trait EventVersion
{
    /**
     * @return array<string, list<string>>
     */
    protected function versionRules(): array
    {
        return ['version' => ['required', 'string', 'max:40']];
    }

    public function version(): string
    {
        return trim($this->string('version')->value());
    }
}
