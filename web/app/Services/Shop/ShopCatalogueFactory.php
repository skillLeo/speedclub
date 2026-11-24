<?php

namespace App\Services\Shop;

use Illuminate\Contracts\Container\Container;

/**
 * Picks the ShopCatalogue driver from speedclub.shop.driver (m5.5-contract §2): `shopify` only when the Storefront token and the store
 * domain are configured, `local` otherwise (also for an unknown value), so a half-set environment never breaks the shop.
 */
final class ShopCatalogueFactory
{
    public static function make(Container $app): ShopCatalogue
    {
        if (config('speedclub.shop.driver') === 'shopify') {
            $shopify = $app->make(ShopifyStorefrontCatalogue::class);

            if ($shopify->configured()) {
                return $shopify;
            }
        }

        return $app->make(LocalShopCatalogue::class);
    }
}
