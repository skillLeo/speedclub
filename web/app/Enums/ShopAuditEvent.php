<?php

namespace App\Enums;

/**
 * M5.5 ADM-66/67 (m5.5-contract §5): every staff change of the shop catalogue and its hero banners.
 */
enum ShopAuditEvent: string
{
    case ProductCreated = 'shop.product_created';
    case ProductUpdated = 'shop.product_updated';
    case ProductShown = 'shop.product_shown';
    case ProductHidden = 'shop.product_hidden';
    case ProductsReordered = 'shop.products_reordered';
    case ProductDeleted = 'shop.product_deleted';
    case ProductRestored = 'shop.product_restored';
    case ImageAdded = 'shop.image_added';
    case ImageUpdated = 'shop.image_updated';
    case ImagesReordered = 'shop.images_reordered';
    case ImageRemoved = 'shop.image_removed';
    case BannerCreated = 'shop.banner_created';
    case BannerUpdated = 'shop.banner_updated';
    case BannerActivated = 'shop.banner_activated';
    case BannerDeactivated = 'shop.banner_deactivated';
    case BannerDeleted = 'shop.banner_deleted';
}
