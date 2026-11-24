<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Enums\Aspiration;
use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The whole set of specs: PUT replaces what was stored, and a key that is not sent is empty afterwards.
 */
class UpdateSpecsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'engine_code' => ['nullable', 'string', 'max:40'],
            'engine_text' => ['nullable', 'string', 'max:100'],
            'displacement_cc' => ['nullable', 'integer', 'min:1', 'max:20000'],
            'fuel' => ['nullable', Rule::enum(Fuel::class)],
            'aspiration' => ['nullable', Rule::enum(Aspiration::class)],
            /** As entered, in power_unit. */
            'power_value' => ['nullable', 'numeric', 'gt:0', 'max:9999', 'required_with:power_unit'],
            'power_unit' => ['nullable', Rule::enum(PowerUnit::class), 'required_with:power_value'],
            'power_source' => ['nullable', Rule::enum(PowerSource::class)],
            'torque_nm' => ['nullable', 'integer', 'min:1', 'max:9999'],
            'torque_source' => ['nullable', Rule::enum(PowerSource::class)],
            'drivetrain' => ['nullable', Rule::enum(Drivetrain::class)],
            'gearbox' => ['nullable', Rule::enum(Gearbox::class)],
            /**
             * M5.9: the "Daten übernehmen?" suggestion the values were taken from (`cache_id` and the variant's `key` of POST
             * ai/specs/suggest). The fields still equal to it carry "Herstellerangabe (KI-Vorschlag)" until changed. Ignored while
             * ai.vehicle_specs is off; 422 `errors.ai_suggestion` when the suggestion is unknown or expired.
             */
            'ai_suggestion' => ['sometimes', 'nullable', 'array:cache_id,variant'],
            'ai_suggestion.cache_id' => ['required_with:ai_suggestion', 'string', 'ulid'],
            'ai_suggestion.variant' => ['required_with:ai_suggestion', 'string', 'max:40'],
        ];
    }
}
