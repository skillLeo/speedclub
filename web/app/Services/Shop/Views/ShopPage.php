<?php

namespace App\Services\Shop\Views;

/**
 * One cursor page of product cards, driver-neutral: the cursors are opaque strings the next request sends back.
 */
final readonly class ShopPage
{
    /**
     * @param  list<ShopProductView>  $items
     */
    public function __construct(
        public array $items,
        public int $perPage,
        public ?string $nextCursor,
        public ?string $prevCursor,
    ) {}
}
