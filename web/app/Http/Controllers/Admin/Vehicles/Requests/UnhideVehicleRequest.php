<?php

namespace App\Http\Controllers\Admin\Vehicles\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-12 "Einblenden" (recent password): what the owner reads (facts) and a reason. */
class UnhideVehicleRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'vehicles.hide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['facts' => ['required', 'string', 'min:10', 'max:5000']];
    }
}
