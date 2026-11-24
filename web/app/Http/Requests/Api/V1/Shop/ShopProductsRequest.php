<?php

namespace App\Http\Requests\Api\V1\Shop;

use App\Enums\ShopCategory;
use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * SHOP-01 product grid (m5.5-contract §3): one category (none = "Alle"), cursor pages of 1…48 (default 20).
 */
class ShopProductsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** One of the chips; leave it out for "Alle". */
            'category' => ['sometimes', 'nullable', 'string', Rule::enum(ShopCategory::class)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.shop.max_page_size')],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor(['shop_products.sort', 'shop_products.id'])],
        ];
    }

    public function category(): ?ShopCategory
    {
        $value = $this->validated('category');

        return is_string($value) ? ShopCategory::tryFrom($value) : null;
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.shop.page_size'));
    }

    public function cursor(): ?string
    {
        $cursor = $this->validated('cursor');

        return is_string($cursor) && $cursor !== '' ? $cursor : null;
    }
}
