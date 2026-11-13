<?php

namespace App\Http\Controllers\Admin\Parts\Requests;

use App\Http\Controllers\Admin\Catalog\Requests\CatalogFormRequest;
use App\Models\Brand;
use App\Models\ModCategory;
use Illuminate\Validation\Rule;

/**
 * ADM-57 create (POST: brand, category and name required) and edit (PATCH: the keys sent). Attributes are {de: {label: value}, en: …};
 * only facts the maker states (09 §8.9: no invented specs). The reason is optional (audit).
 */
class ProductRequest extends CatalogFormRequest
{
    protected function reasonRequired(): bool
    {
        return false;
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'brand_id' => [$required, 'integer', Rule::exists(Brand::class, 'id')->whereNull('merged_into_id')],
            'category_id' => [$required, 'integer', Rule::exists(ModCategory::class, 'id')],
            'name' => [$required, 'string', 'min:2', 'max:160'],
            'line' => ['sometimes', 'nullable', 'string', 'max:120'],
            'attributes' => ['sometimes', 'nullable', 'array'],
            'attributes.de' => ['sometimes', 'array', 'max:12'],
            'attributes.en' => ['sometimes', 'array', 'max:12'],
            'url' => ['sometimes', 'nullable', 'string', 'url:https', 'max:500'],
            'affiliate_url' => ['sometimes', 'nullable', 'string', 'url:https', 'max:500'],
            'aliases' => ['sometimes', 'nullable', 'array', 'max:20'],
            'aliases.*' => ['string', 'max:160'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function productData(): array
    {
        $data = $this->validated();
        unset($data['reason']);

        return $data;
    }

    public function optionalReason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }
}
