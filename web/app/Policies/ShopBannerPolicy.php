<?php

namespace App\Policies;

use App\Models\ShopBanner;
use App\Models\User;
use App\Services\Shop\LocalShopCatalogue;
use App\Services\Showcase\SampleContent;

/**
 * M5.5: a shop banner is seen while it is the active hero and what it links to can be followed (LocalShopCatalogue::bannerLinkShown),
 * and no sample while sample content is hidden. Members never change one; staff manage banners through the ADM-67 routes (atom
 * shop.manage), never through these abilities.
 */
class ShopBannerPolicy
{
    public function view(?User $user, ShopBanner $banner): bool
    {
        return $banner->active
            && ($banner->is_sample === false || app(SampleContent::class)->visible())
            && app(LocalShopCatalogue::class)->bannerLinkShown($banner);
    }
}
