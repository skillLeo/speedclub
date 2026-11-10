<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * POST vehicles and PATCH vehicles/{id}. Only the keys sent change. Catalogue id or free text per level ("Nicht gefunden?"); that
 * the three catalogue ids belong together is checked by App\Services\Garage\VehicleAttributes, which knows the stored ones.
 */
class VehicleAttributesRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'make_id' => ['sometimes', 'nullable', 'integer', Rule::exists(Make::class, 'id')->where('active', true)],
            'model_id' => ['sometimes', 'nullable', 'integer', Rule::exists(VehicleModel::class, 'id')->where('active', true)],
            'generation_id' => ['sometimes', 'nullable', 'integer', Rule::exists(Generation::class, 'id')->where('active', true)],
            'make_text' => ['sometimes', 'nullable', 'string', 'max:100', 'prohibits:make_id'],
            'model_text' => ['sometimes', 'nullable', 'string', 'max:100', 'prohibits:model_id'],
            'model_year' => ['sometimes', 'nullable', 'integer', 'min:1886', 'max:'.(Carbon::now(config()->string('speedclub.display_timezone'))->year + 1)],
            'nickname' => ['sometimes', 'nullable', 'string', 'max:60'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'color' => ['sometimes', 'nullable', 'string', 'max:60'],
            /** Month of the next inspection, as YYYY-MM ([SIGNATURE] sig.hu_au_reminder). */
            'hu_au_due' => ['sometimes', 'nullable', 'date_format:Y-m'],
            /** Where the wizard resumes. Ignored once the vehicle is published. */
            'wizard_step' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.garage.wizard_steps')],
            /** A finished photo of this vehicle; null falls back to the first one. */
            'cover_media_id' => ['sometimes', 'nullable', 'string', 'ulid'],
        ];
    }
}
