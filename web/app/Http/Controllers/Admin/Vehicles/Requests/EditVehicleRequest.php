<?php

namespace App\Http\Controllers\Admin\Vehicles\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-12 "Bearbeiten" (recent password): catalogue relink and title fields (VehicleAttributes checks that they fit), a reason. */
class EditVehicleRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'vehicles.edit';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'make_id' => ['sometimes', 'nullable', 'integer', 'exists:makes,id'],
            'model_id' => ['sometimes', 'nullable', 'integer', 'exists:vehicle_models,id'],
            'generation_id' => ['sometimes', 'nullable', 'integer', 'exists:generations,id'],
            'make_text' => ['sometimes', 'nullable', 'string', 'max:100'],
            'model_text' => ['sometimes', 'nullable', 'string', 'max:100'],
            'model_year' => ['sometimes', 'nullable', 'integer', 'min:1886', 'max:'.(now()->year + 1)],
            'nickname' => ['sometimes', 'nullable', 'string', 'max:60'],
        ];
    }
}
