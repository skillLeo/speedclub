<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Enums\Visibility;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PublishVehicleRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The choice of wizard step 4. Without it the draft keeps what it has, public by default. */
            'visibility' => ['sometimes', Rule::enum(Visibility::class)],
        ];
    }
}
