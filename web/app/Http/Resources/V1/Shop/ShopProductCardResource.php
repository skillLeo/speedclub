<?php

namespace App\Http\Resources\V1\Shop;

use App\Services\Shop\ShopPrice;
use App\Services\Shop\Views\ShopProductView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A SHOP-01 grid tile (m5.5-contract §3.2): title, gross price (PAngV: incl. MwSt.; the caption comes from the app), the first 4:5
 * photo, how it is bought, and whether it is a sample (badge "Beispiel").
 *
 * @property ShopProductView $resource
 */
class ShopProductCardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $product = $this->resource;
        $image = $product->image();

        return [
            'id' => $product->id,
            'slug' => $product->slug,
            'title' => $product->title,
            'category' => ['key' => $product->category->value, 'label' => $product->category->label()],
            'price' => [
                'amount_cents' => $product->priceCents,
                /** @var 'EUR' */
                'currency' => $product->currency,
                /** "14,90 €" (de) or "€14.90" (en). */
                'formatted' => ShopPrice::format($product->priceCents, $product->currency),
                /** Always true: the price is gross, incl. MwSt. */
                'vat_included' => true,
            ],
            /** @var ShopImageResource|null */
            'image' => $image === null ? null : new ShopImageResource($image),
            /** @var 'shopify'|'sticker_designer' */
            'purchase_mode' => $product->purchaseMode->value,
            'is_sample' => $product->isSample,
        ];
    }
}
