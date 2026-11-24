<?php

namespace App\Http\Requests\Api\V1\Ai;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;

/**
 * POST ai/specs/suggest (M5.9, m5.9-contract §2.1): a catalogue generation, or a model and year when the model has no generations.
 */
class SuggestSpecsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The catalogue generation the member chose in the wizard. */
            'generation_id' => ['required_without:model_id', 'nullable', 'integer', 'min:1'],
            /** Only for a model without generations, with the model year. */
            'model_id' => ['required_without:generation_id', 'nullable', 'integer', 'min:1'],
            'model_year' => ['required_with:model_id', 'nullable', 'integer', 'min:1886', 'max:'.(Carbon::now(config()->string('speedclub.display_timezone'))->year + 1)],
        ];
    }
}
