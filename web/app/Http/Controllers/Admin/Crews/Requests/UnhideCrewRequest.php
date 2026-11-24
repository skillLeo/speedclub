<?php

namespace App\Http\Controllers\Admin\Crews\Requests;

/** ADM-81 "Einblenden" (recent password): why the measure ends, as the founder reads it (facts), and a reason. */
class UnhideCrewRequest extends CrewReasonRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['facts' => ['required', 'string', 'min:10', 'max:5000']];
    }
}
