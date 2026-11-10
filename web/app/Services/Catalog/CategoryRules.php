<?php

namespace App\Services\Catalog;

use App\Models\ModCategory;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The input of an ADM-15 category: {key, name {de, en}, icon?, sort?, active?}. The sort is also the category's bit in
 * vehicle_search.mod_category_mask (VehicleSearchProjector: 1 << (sort − 1) in a 64-bit integer), hence 1–63.
 */
final class CategoryRules
{
    public const MAX_SORT = 63;

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?ModCategory $existing): array
    {
        $required = $existing === null ? 'required' : 'sometimes';

        /** @var array<string, mixed> $valid */
        $valid = Validator::make($input, [
            'key' => [$required, 'string', 'regex:/^[a-z][a-z0-9_]{1,39}$/', Rule::unique(ModCategory::class, 'key')->ignore($existing?->getKey())],
            'name' => [$required, 'array:de,en'],
            'name.de' => ['required_with:name', 'string', 'min:1', 'max:60'],
            'name.en' => ['required_with:name', 'string', 'min:1', 'max:60'],
            'icon' => ['sometimes', 'nullable', 'string', 'max:60', 'regex:/^[a-z0-9-]+$/'],
            'sort' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_SORT, ...($existing === null ? [Rule::unique(ModCategory::class, 'sort')] : [])],
            'active' => ['sometimes', 'boolean'],
        ])->validate();

        return $valid;
    }

    /**
     * @throws ValidationException
     */
    public static function ensureSortFits(int $sort): void
    {
        if ($sort > self::MAX_SORT) {
            throw ValidationException::withMessages(['sort' => [(string) __('validation.max.numeric', ['attribute' => 'sort', 'max' => self::MAX_SORT])]]);
        }
    }
}
