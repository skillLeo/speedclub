<?php

namespace App\Http\Controllers\Admin\Vehicles\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;

/** ADM-12 "Ausblenden" (recent password): the statement of reasons the owner reads, and a reason. */
class HideVehicleRequest extends ReasonRequest
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
        return Statement::rules();
    }
}
