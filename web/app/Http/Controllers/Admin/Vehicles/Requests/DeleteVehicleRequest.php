<?php

namespace App\Http\Controllers\Admin\Vehicles\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;

/** ADM-12 "Löschen" (recent password, typed confirmation): statement of reasons, reason. */
class DeleteVehicleRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'vehicles.delete';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [...Statement::rules(), 'confirm' => ['required', 'string', 'in:LÖSCHEN,DELETE']];
    }
}
