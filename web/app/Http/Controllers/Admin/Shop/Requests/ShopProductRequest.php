<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;
use App\Models\ShopProduct;
use App\Services\Shop\ShopDomain;
use App\Services\Shop\ShopLinks;
use Closure;
use Illuminate\Validation\Rule;

/**
 * ADM-66 create (POST: title, category, price required) and edit (PATCH: the keys sent). Prices are gross cents incl. MwSt.; EUR only.
 * The Shopify URL must be https on an allowed store host, /products/{handle}, at most `?variant=<digits>` (ShopLinks); without a
 * configured store none can be saved. Variants: ≤ 24 chips, each a label and an optional Shopify variant id (digits). is_sample is never
 * settable here.
 */
class ShopProductRequest extends ShopFormRequest
{
    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        $product = $this->route('product');
        $ignore = is_string($product) ? strtolower($product) : null;

        return [
            'title' => [$required, 'string', 'min:2', 'max:120'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:140', 'regex:/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/',
                Rule::unique(ShopProduct::class, 'slug')->ignore($ignore)],
            'description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'category' => [$required, 'string', Rule::enum(ShopCategory::class)],
            'price_cents' => [$required, 'integer', 'min:1', 'max:99999999'],
            'currency' => ['sometimes', 'string', 'in:EUR'],
            'variant_kind' => ['sometimes', 'string', Rule::enum(ShopVariantKind::class)],
            'variants' => ['sometimes', 'nullable', 'array', 'max:'.config()->integer('speedclub.shop.max_variants')],
            'variants.*.id' => ['sometimes', 'nullable', 'string', 'regex:/\A[0-9a-z]{8}\z/'],
            'variants.*.label' => ['required', 'string', 'min:1', 'max:40'],
            'variants.*.shopify_variant_id' => ['sometimes', 'nullable', 'string', 'regex:/\A\d{1,20}\z/'],
            'purchase_mode' => ['sometimes', 'string', Rule::enum(ShopPurchaseMode::class)],
            'shopify_url' => ['sometimes', 'nullable', 'string', 'max:500', function (string $attribute, mixed $value, Closure $fail): void {
                if (! is_string($value) || trim($value) === '') {
                    return;
                }

                if (! app(ShopDomain::class)->configured()) {
                    $fail((string) __('shop.validation.store_missing'));
                } elseif (app(ShopLinks::class)->normalise($value) === null) {
                    $fail((string) __('shop.validation.shopify_url'));
                }
            }],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'slug.unique' => (string) __('shop.validation.slug_taken'),
            'variants.*.shopify_variant_id.regex' => (string) __('shop.validation.variant_id'),
        ];
    }
}
