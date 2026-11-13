<?php

namespace App\Services\Parts;

use App\Models\Product;
use App\Models\User;

/**
 * Fills Product::$buildCount for a page of products (one grouped query), so ProductRow shows "In 14 Builds" with real numbers.
 */
final class ProductPresenter
{
    public function __construct(private readonly PartBuilds $builds) {}

    /**
     * @param  iterable<Product>  $products
     */
    public function prepare(iterable $products, ?User $viewer): void
    {
        $list = [];

        foreach ($products as $product) {
            $list[] = $product;
        }

        $counts = $this->builds->productCounts($viewer, array_map(fn (Product $product): string => $product->id, $list));

        foreach ($list as $product) {
            $product->buildCount = $counts[$product->id] ?? 0;
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
