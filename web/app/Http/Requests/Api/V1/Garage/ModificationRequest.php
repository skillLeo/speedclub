<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Enums\LegalStatus;
use App\Enums\ModStatus;
use App\Models\Brand;
use App\Models\ModCategory;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The fields common to every category (02_PRODUCT_SPEC §3.3). `fields` is checked against the schema of the category by
 * App\Services\Garage\ModFields, because that schema is data. POST needs `category`; on PATCH the category cannot change, and only
 * the keys sent change, `fields` as a whole.
 */
class ModificationRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Key from catalog/mod-categories. */
            'category' => $this->isMethod('POST')
                ? ['required', 'string', Rule::exists(ModCategory::class, 'key')->where('active', true)]
                : ['prohibited'],
            /** Brand + model when left out. */
            'title' => ['sometimes', 'nullable', 'string', 'max:160'],
            'brand_id' => ['sometimes', 'nullable', 'integer', Rule::exists(Brand::class, 'id')],
            'brand_text' => ['sometimes', 'nullable', 'string', 'max:120', 'prohibits:brand_id'],
            'part_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'part_number' => ['sometimes', 'nullable', 'string', 'max:80'],
            'status' => ['sometimes', Rule::enum(ModStatus::class)],
            /** Month of installation as YYYY-MM. Dropped for a planned part. */
            'installed_on' => ['sometimes', 'nullable', 'date_format:Y-m'],
            /** Private, always: only the owner reads it (09 §11). */
            'cost_cents' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
            /** Ignored since M4.9 (costs are never public); accepted so older apps keep working. */
            'cost_public' => ['sometimes', 'boolean'],
            /** Ignored while the flag sig.mod_legal_status is off. */
            'legal_status' => ['sometimes', 'nullable', Rule::enum(LegalStatus::class)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            /** Key and value per the category's schema, unknown keys are refused. */
            'fields' => ['sometimes', 'array'],
        ];
    }
}
