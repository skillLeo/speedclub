<?php

namespace App\Http\Controllers\Admin\CarOfTheDay\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-64 "Anderes Auto festlegen": content.edit, the car (ULID) and a reason; OverrideCarOfTheDay checks the day and the car. */
class OverrideCarOfTheDayRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'content.edit';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['vehicle_id' => ['required', 'string', 'size:26']];
    }
}
