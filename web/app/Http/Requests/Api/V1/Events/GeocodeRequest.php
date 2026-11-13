<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class GeocodeRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** An address, venue or place, searched on submit (never per keystroke, 09 §8.7). */
            'q' => ['required', 'string', 'min:'.config()->integer('speedclub.geocode.query_min'), 'max:'.config()->integer('speedclub.geocode.query_max')],
        ];
    }
}
