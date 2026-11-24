<?php

namespace App\Policies;

use App\Models\ShopProduct;
use App\Models\User;
use App\Services\Showcase\SampleContent;

/**
 * M5.5 SHOP-01/02 (m5.5-contract §3): everyone reads the shop, guests and restricted members included (reading a shop is not
 * restricted, nothing in it belongs to another member, so blocks do not apply). A product is seen while it is visible, not deleted,
 * has a photo, and is no sample while editorial_samples is off (09 §8.19: the same 404 as a missing one). Staff reach products through
 * the ADM-66 routes (atom shop.manage), never through this.
 */
class ShopProductPolicy
{
    public function viewAny(?User $user): bool
    {
        return true;
    }

    public function view(?User $user, ShopProduct $product): bool
    {
        return ! $product->trashed()
            && $product->visible
            && $product->images->isNotEmpty()
            && ($product->is_sample === false || app(SampleContent::class)->visible());
    }
}
