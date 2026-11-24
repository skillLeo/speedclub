<?php

namespace App\Services\Shop;

use App\Enums\ShopCategory;
use App\Services\Shop\Views\ShopHeroView;
use App\Services\Shop\Views\ShopPage;
use App\Services\Shop\Views\ShopProductView;

/**
 * The Shopify Storefront API driver (m5.5-contract §2, OA-44): a stub until the client provides a Storefront token, with no network
 * call anywhere. Not configured (no token or no store domain): ShopCatalogueFactory binds `local` instead, and ADM-50 shows
 * "Shopify Storefront: nicht eingerichtet". Configured while still a stub: every read throws ShopCatalogueUnavailable, so the member
 * API answers 503 shop_unavailable — honest, never a broken page. The GraphQL mapping (products, variants, images, prices incl. VAT)
 * comes with the token (Phase 6 backlog).
 */
final class ShopifyStorefrontCatalogue implements ShopCatalogue
{
    public function __construct(private readonly ShopDomain $domain) {}

    public static function tokenConfigured(): bool
    {
        $token = config('speedclub.shop.shopify.storefront_token');

        return is_string($token) && trim($token) !== '';
    }

    public function configured(): bool
    {
        return self::tokenConfigured() && $this->domain->configured();
    }

    public function driver(): string
    {
        return 'shopify';
    }

    public function hero(): ?ShopHeroView
    {
        throw $this->unavailable();
    }

    public function categories(): array
    {
        throw $this->unavailable();
    }

    public function products(?ShopCategory $category, int $perPage, ?string $cursor): ShopPage
    {
        throw $this->unavailable();
    }

    public function product(string $idOrSlug): ?ShopProductView
    {
        throw $this->unavailable();
    }

    private function unavailable(): ShopCatalogueUnavailable
    {
        return new ShopCatalogueUnavailable('The Shopify Storefront driver is not implemented yet.');
    }
}
