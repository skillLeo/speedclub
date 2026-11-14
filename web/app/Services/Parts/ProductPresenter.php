<?php

namespace App\Services\Parts;

use App\Models\Product;
use App\Models\User;

/**
 * Fills Product::$buildCount (real builds only, DQ-1140) and Product::$thumbnail (ADR-457) for a page of products, in one grouped query
 * each, so ProductRow shows "In 14 Builds" with real numbers and a photo from a real build.
 */
final class ProductPresenter
{
    public function __construct(
        private readonly PartBuilds $builds,
        private readonly PartPhotos $photos,
    ) {}

    /**
     * @param  iterable<Product>  $products
     */
    public function prepare(iterable $products, ?User $viewer): void
    {
        $list = [];

        foreach ($products as $product) {
            $list[] = $product;
        }

        $ids = array_map(fn (Product $product): string => $product->id, $list);
        $counts = $this->builds->productCounts($viewer, $ids);
        $thumbnails = $this->photos->thumbnails($viewer, $ids);

        foreach ($list as $product) {
            $product->buildCount = $counts[$product->id] ?? 0;
            $product->thumbnail = $thumbnails[$product->id] ?? null;
        }
    }

    /**
     * The product a link points at: the survivor of a merge, or itself.
     */
    public static function survivor(Product $product): Product
    {
        $hops = 0;

        while ($product->merged_into_id !== null && $hops++ < 5) {
            $next = Product::query()->with(['brand', 'category'])->find($product->merged_into_id);

            if (! $next instanceof Product) {
                break;
            }

            $product = $next;
        }

        return $product;
    }
}
