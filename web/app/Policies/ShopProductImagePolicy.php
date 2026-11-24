<?php

namespace App\Policies;

use App\Models\ShopProductImage;
use App\Models\User;

/**
 * M5.5: a shop photo is seen exactly when its product is (ShopProductPolicy::view). Members never change one; staff manage photos
 * through the ADM-66 routes (atom shop.manage), never through these abilities.
 */
class ShopProductImagePolicy
{
    public function view(?User $user, ShopProductImage $image): bool
    {
        $product = $image->product;

        return $product !== null && app(ShopProductPolicy::class)->view($user, $product);
    }
}
