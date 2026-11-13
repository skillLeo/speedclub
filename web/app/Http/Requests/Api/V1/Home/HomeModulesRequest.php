<?php

namespace App\Http\Requests\Api\V1\Home;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET home/modules. `lat`/`lng`: the device location for "Treffen in deiner Nähe", asked on demand, used for this request only and never
 * stored (09 §8.7); without it the member's SET-11 region applies, and without both the module stays empty.
 */
class HomeModulesRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'lat' => ['sometimes', 'required_with:lng', 'numeric', 'between:-90,90'],
            'lng' => ['sometimes', 'required_with:lat', 'numeric', 'between:-180,180'],
        ];
    }

    /**
     * @return array{0: float, 1: float}|null
     */
    public function point(): ?array
    {
        return $this->filled('lat') && $this->filled('lng') ? [(float) $this->input('lat'), (float) $this->input('lng')] : null;
    }
}
