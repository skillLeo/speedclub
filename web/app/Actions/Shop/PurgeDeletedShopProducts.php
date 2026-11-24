<?php

namespace App\Actions\Shop;

use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Services\Shop\ShopImages;
use Illuminate\Support\Facades\DB;

/**
 * M5.5 (m5.5-contract §1): products deleted in ADM-66 longer than speedclub.shop.purge_after_days ago are removed for good, with their
 * photos' files. Chunked and idempotent (a missing file is fine); stops before the time budget so a cron run ends < 50 s.
 */
class PurgeDeletedShopProducts
{
    public function __construct(private readonly ShopImages $images) {}

    /**
     * @return int how many products were purged
     */
    public function handle(int $budgetSeconds = 40): int
    {
        $started = microtime(true);
        $cutoff = now()->subDays(config()->integer('speedclub.shop.purge_after_days'));
        $purged = 0;

        while (microtime(true) - $started < $budgetSeconds) {
            $batch = ShopProduct::onlyTrashed()->where('deleted_at', '<', $cutoff)->orderBy('deleted_at')->limit(20)->get();

            if ($batch->isEmpty()) {
                break;
            }

            foreach ($batch as $product) {
                // Re-checked under a lock: a product restored since the batch was read is left alone (review nit "purge vs restore").
                $images = DB::transaction(function () use ($product, $cutoff): ?array {
                    $locked = ShopProduct::onlyTrashed()->whereKey($product->id)->where('deleted_at', '<', $cutoff)->lockForUpdate()->first();

                    if ($locked === null) {
                        return null;
                    }

                    $images = ShopProductImage::query()->where('shop_product_id', $locked->id)->get(['id', 'variants', 'original_path'])->all();
                    $locked->forceDelete();

                    return $images;
                });

                if ($images === null) {
                    continue;
                }

                foreach ($images as $image) {
                    $this->images->delete($image->variants, $image->original_path);
                }

                $purged++;
            }
        }

        return $purged;
    }
}
