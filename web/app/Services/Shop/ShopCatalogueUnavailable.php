<?php

namespace App\Services\Shop;

use RuntimeException;

/**
 * The catalogue driver cannot answer: the member API turns it into 503 shop_unavailable (m5.5-contract §2).
 */
final class ShopCatalogueUnavailable extends RuntimeException {}
