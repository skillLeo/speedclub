<?php

namespace App\Http\Requests\Api\V1\Me;

use Illuminate\Foundation\Http\FormRequest;

class PlateCheckDecisionRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** `keep`: "Kein Kennzeichen sichtbar". Pixelating goes through `PATCH media/{media}` with `blur_regions`. */
            'decision' => ['required', 'string', 'in:keep'],
        ];
    }
}
