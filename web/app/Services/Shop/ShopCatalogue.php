<?php

namespace App\Services\Shop;

use App\Enums\ShopCategory;
use App\Services\Shop\Views\ShopCategoryCount;
use App\Services\Shop\Views\ShopHeroView;
use App\Services\Shop\Views\ShopPage;
use App\Services\Shop\Views\ShopProductView;

/**
 * Where SHOP-01/02 read the shop from (10 §3, ADR-502, m5.5-contract §2): `local` (the ADM-66 catalogue, complete) or `shopify` (the
 * Storefront API once the client gives a token, OA-44; a stub until then). The answer is the same for every reader (no per-viewer
 * field), so it can carry one ETag. A driver that cannot answer throws ShopCatalogueUnavailable (503 shop_unavailable).
 */
interface ShopCatalogue
{
    public function driver(): string;

    public function hero(): ?ShopHeroView;

    /**
     * "Alle" first, then the categories in enum order, each with the real number of products its list returns.
     *
     * @return list<ShopCategoryCount>
     */
    public function categories(): array;

    public function products(?ShopCategory $category, int $perPage, ?string $cursor): ShopPage;

    /**
     * By ULID or slug; null when it is unknown or may not be shown (404 shop_product_unavailable).
     */
    public function product(string $idOrSlug): ?ShopProductView;
}
