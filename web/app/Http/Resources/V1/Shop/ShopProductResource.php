<?php

namespace App\Http\Resources\V1\Shop;

use App\Services\Shop\ShopLinks;
use App\Services\Shop\Views\ShopImageView;
use App\Services\Shop\Views\ShopProductView;
use App\Services\Shop\Views\ShopVariantView;
use Illuminate\Http\Request;

/**
 * SHOP-02 (m5.5-contract §3.3): the card fields plus description (plain text, paragraphs by blank lines), the gallery, the one chip row
 * of variants (each with its own buy link: a cart permalink when it carries a Shopify variant id), the product's buy link and the
 * store (host for "Du wechselst zum Online-Shop", the shipping policy link next to the price).
 *
 * @property ShopProductView $resource
 */
class ShopProductResource extends ShopProductCardResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $product = $this->resource;

        return [
            ...parent::toArray($request),
            /** @var string|null */
            'description' => $product->description,
            /** @var list<ShopImageResource> */
            'images' => array_map(fn (ShopImageView $image): ShopImageResource => new ShopImageResource($image), $product->images),
            'variant_kind' => ['key' => $product->variantKind->value, 'label' => $product->variantKind->label()],
            /** @var list<array{id: string, label: string, buy: ShopBuyResource}> */
            'variants' => array_map(fn (ShopVariantView $variant): array => [
                'id' => $variant->id,
                'label' => $variant->label,
                'buy' => new ShopBuyResource($variant->buy),
            ], $product->variants),
            'buy' => new ShopBuyResource($product->buy),
            /** @var array{configured: bool, host: string|null, shipping_url: string|null} */
            'store' => app(ShopLinks::class)->store(),
        ];
    }
}
