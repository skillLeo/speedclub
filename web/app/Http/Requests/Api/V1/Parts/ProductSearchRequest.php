<?php

namespace App\Http\Requests\Api\V1\Parts;

use App\Models\ModCategory;
use Illuminate\Validation\Rule;

/**
 * Product search and the mod editor's autocomplete (09 §8.9): `q` (2–80 characters) against name, line, aliases and brand; `brand`
 * (slug) and `category` (mod category key) narrow it. `counts` adds the real build counts of the rows (the Teile scope); the editor
 * leaves it off.
 */
class ProductSearchRequest extends PartsPageRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'q' => ['sometimes', 'nullable', 'string', 'min:'.config()->integer('speedclub.parts.query_min'), 'max:'.config()->integer('speedclub.parts.query_max')],
            'brand' => ['sometimes', 'nullable', 'string', 'max:140'],
            'category' => ['sometimes', 'nullable', 'string', Rule::exists(ModCategory::class, 'key')],
            'counts' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array{q: string|null, brand: string|null, category: string|null}
     */
    public function filters(): array
    {
        $string = fn (string $key): ?string => is_string($value = $this->validated($key)) && trim($value) !== '' ? trim($value) : null;

        return ['q' => $string('q'), 'brand' => $string('brand'), 'category' => $string('category')];
    }
}
