<?php

namespace App\Http\Requests\Api\V1\Social2;

use Illuminate\Foundation\Http\FormRequest;

class SetVehicleCommentsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['enabled' => ['required', 'boolean:strict']];
    }
}
