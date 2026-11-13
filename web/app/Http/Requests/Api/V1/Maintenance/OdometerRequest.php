<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use Illuminate\Foundation\Http\FormRequest;

class OdometerRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The mileage now, in km (the app converts mi). */
            'km' => ['required', 'integer', 'min:0', 'max:'.MaintenanceRules::MAX_KM],
        ];
    }
}
