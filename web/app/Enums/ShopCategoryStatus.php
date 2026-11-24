<?php

namespace App\Enums;

/**
 * R4-3.2 (SHOP-01): whether a category chip opens its list. coming_soon chips are shown ("Bald verfügbar") but not selectable, and
 * their list answers an empty page. Set per category in speedclub.shop.categories.
 */
enum ShopCategoryStatus: string
{
    case Available = 'available';
    case ComingSoon = 'coming_soon';
}
