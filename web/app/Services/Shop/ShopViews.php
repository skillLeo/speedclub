<?php

namespace App\Services\Shop;

use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Services\Shop\Views\ShopHeroView;
use App\Services\Shop\Views\ShopProductView;
use App\Services\Shop\Views\ShopVariantView;

/**
 * Turns local catalogue rows into the driver-neutral views (m5.5-contract §2, §3). Used by LocalShopCatalogue for members and by
 * ADM-66 for the preview of a hidden product, so the admin preview is exactly the member payload.
 */
final class ShopViews
{
    public function __construct(
        private readonly ShopImages $images,
        private readonly ShopLinks $links,
    ) {}

    public function product(ShopProduct $product): ShopProductView
    {
        $variants = [];

        foreach ($product->variantList() as $variant) {
            $variants[] = new ShopVariantView($variant['id'], $variant['label'], $this->links->variant($product->purchase_mode, $product->shopify_url, $variant['shopify_variant_id']));
        }

        return new ShopProductView(
            id: $product->id,
            slug: $product->slug,
            title: $product->title,
            description: $product->description,
            category: $product->category,
            priceCents: $product->price_cents,
            currency: $product->currency,
            purchaseMode: $product->purchase_mode,
            isSample: $product->is_sample,
            images: array_values($product->images->map(fn (ShopProductImage $image) => $this->images->view($image))->all()),
            variantKind: $product->variant_kind,
            variants: $variants,
            buy: $this->links->product($product->purchase_mode, $product->shopify_url),
        );
    }

    public function hero(ShopBanner $banner, ?ShopProduct $product): ShopHeroView
    {
        return new ShopHeroView(
            id: $banner->id,
            title: $banner->title,
            subtitle: $banner->subtitle,
            image: $this->images->view($banner),
            linkKind: $banner->link_kind,
            category: $banner->category,
            productId: $product?->id,
            productSlug: $product?->slug,
            isSample: $banner->is_sample,
        );
    }
}
