<?php

namespace App\Http\Requests\Api\V1\Ai;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST ai/products/match (M5.9, m5.9-contract §2.2): what the member typed for a part, and the mod's category when chosen.
 */
class MatchProductRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The typed part, e.g. "kw v3". */
            'text' => ['required', 'string', 'min:2', 'max:80'],
            /** The mod's category (GAR-10), narrows the products. */
            'category_key' => ['sometimes', 'nullable', 'string', 'max:40'],
        ];
    }
}
