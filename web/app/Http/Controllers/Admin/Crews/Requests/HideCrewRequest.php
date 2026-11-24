<?php

namespace App\Http\Controllers\Admin\Crews\Requests;

use App\Services\Moderation\Statement;

/** ADM-80/81 "Ausblenden" (recent password): the statement of reasons the founder reads (Art. 17 DSA) and a reason. */
class HideCrewRequest extends CrewReasonRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return Statement::rules();
    }
}
