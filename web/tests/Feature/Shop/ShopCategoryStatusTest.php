<?php

use App\Enums\RestrictionType;
use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ShopTestHelpers.php';

/**
 * R4-3.2 (SHOP-01): every category carries status available | coming_soon from speedclub.shop.categories. Sticker is open; clothing
 * and accessories are "Bald verfügbar": visible chips with count 0, an empty page (never an error) for their list, and their products
 * stay out of "Alle", the hero and the detail.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
});

it('ships sticker available and clothing and accessories coming soon by default', function () {
    expect(config('speedclub.shop.categories'))->toBe(['sticker' => 'available', 'apparel' => 'coming_soon', 'accessories' => 'coming_soon']);

    ShopProduct::factory()->listed()->create(['category' => ShopCategory::Sticker]);
    ShopProduct::factory()->listed()->create(['category' => ShopCategory::Apparel]);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.categories', [
        ['key' => 'all', 'label' => 'Alle', 'count' => 1, 'status' => 'available'],
        ['key' => 'sticker', 'label' => 'Sticker', 'count' => 1, 'status' => 'available'],
        ['key' => 'apparel', 'label' => 'Kleidung', 'count' => 0, 'status' => 'coming_soon'],
        ['key' => 'accessories', 'label' => 'Accessoires', 'count' => 0, 'status' => 'coming_soon'],
    ]);
});

it('answers an empty page with the status for a coming soon category, for every reader', function (string $who) {
    ShopProduct::factory()->listed()->create(['category' => ShopCategory::Apparel]);

    match ($who) {
        'member' => Sanctum::actingAs(User::factory()->create()),
        'restricted' => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create()),
        default => null,
    };

    $this->getJson('/api/v1/shop/products?category=apparel')->assertOk()->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.category_status', 'coming_soon')->assertJsonPath('meta.next_cursor', null);
    $this->getJson('/api/v1/shop/products?category=accessories')->assertOk()->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.category_status', 'coming_soon');
})->with(['guest', 'member', 'restricted']);

it('marks an open category and "Alle" available, and leaves coming soon products out of "Alle"', function () {
    $sticker = ShopProduct::factory()->listed()->create(['category' => ShopCategory::Sticker]);
    ShopProduct::factory()->listed()->create(['category' => ShopCategory::Accessories]);

    $this->getJson('/api/v1/shop/products?category=sticker')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.category_status', 'available');
    $this->getJson('/api/v1/shop/products')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $sticker->id)
        ->assertJsonPath('meta.category_status', 'available');
});

it('answers 404 for the detail of a coming soon product and hides a hero that leads there', function () {
    $shirt = ShopProduct::factory()->listed()->create(['category' => ShopCategory::Apparel, 'slug' => 'shirt']);
    ShopBanner::factory()->active()->create(['link_kind' => ShopBannerLink::Product, 'shop_product_id' => $shirt->id, 'category' => null]);

    $this->getJson('/api/v1/shop/products/shirt')->assertNotFound()->assertJsonPath('code', 'shop_product_unavailable');
    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.hero', null);
});

it('opens a category from the config alone', function () {
    $shirt = ShopProduct::factory()->listed()->create(['category' => ShopCategory::Apparel, 'slug' => 'shirt']);
    config(['speedclub.shop.categories.apparel' => 'available']);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.categories.2', ['key' => 'apparel', 'label' => 'Kleidung', 'count' => 1, 'status' => 'available']);
    $this->getJson('/api/v1/shop/products?category=apparel')->assertOk()->assertJsonPath('data.0.id', $shirt->id)->assertJsonPath('meta.category_status', 'available');
    $this->getJson('/api/v1/shop/products/shirt')->assertOk();
});

it('keeps a category the config misses or misspells closed', function (mixed $value) {
    ShopProduct::factory()->listed()->create(['category' => ShopCategory::Accessories]);
    config(['speedclub.shop.categories.accessories' => $value]);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.categories.3.status', 'coming_soon')->assertJsonPath('data.categories.3.count', 0);
})->with(['missing' => [null], 'typo' => ['availabel']]);

it('still refuses an unknown category with 422', function () {
    $this->getJson('/api/v1/shop/products?category=hats')->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
});

it('answers 404 feature_disabled while shop is off', function () {
    shopFlags(['shop' => false]);

    $this->getJson('/api/v1/shop/products?category=apparel')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});
