<?php

use App\Enums\RestrictionType;
use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Models\Staff;
use App\Models\User;
use App\Services\Shop\ShopCatalogue;
use App\Support\ViewAs;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ShopTestHelpers.php';

/**
 * M5.5 SHOP-01/02 member API (10 §3, ADR-502, m5.5-contract §3): the flag, guests and every kind of member read the same shop, hidden /
 * deleted / photo-less products and samples while samples are off stay out (list and 404), categories with real counts, cursor pages,
 * the server-built buy links (product URL, cart permalink of a variant, the designer, "Bald im Shop erhältlich"), price formatting,
 * the ETag, and the Shopify driver's honest 503 while it is a stub.
 */
beforeEach(function () {
    // Symfony's test requests send Accept-Language en-us unless told otherwise.
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
});

function shopProduct(array $attributes = []): ShopProduct
{
    return ShopProduct::factory()->listed()->create($attributes);
}

it('answers 404 feature_disabled on every route while shop is off', function (string $uri) {
    shopFlags(['shop' => false]);
    shopProduct(['slug' => 'car-sticker']);

    $this->getJson($uri)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
})->with(['/api/v1/shop', '/api/v1/shop/products', '/api/v1/shop/products/car-sticker']);

it('reads the same shop for a guest, a member, a restricted member and a view-as token', function (string $who) {
    $product = shopProduct(['slug' => 'car-sticker', 'title' => 'Car-Sticker']);
    $member = User::factory()->create();
    $headers = [];

    match ($who) {
        'member' => Sanctum::actingAs($member),
        'restricted' => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create()),
        'view-as' => $headers = ['Authorization' => 'Bearer '.$member->createToken(ViewAs::NAME_PREFIX.Staff::factory()->twoFactorConfirmed()->create()->id, ['view-as'])->plainTextToken],
        default => null,
    };

    $this->getJson('/api/v1/shop', $headers)->assertOk()->assertJsonPath('data.categories.0', ['key' => 'all', 'label' => 'Alle', 'count' => 1, 'status' => 'available']);
    $this->getJson('/api/v1/shop/products', $headers)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $product->id);
    $this->getJson('/api/v1/shop/products/car-sticker', $headers)->assertOk()->assertJsonPath('data.title', 'Car-Sticker');
})->with(['guest', 'member', 'restricted', 'view-as']);

it('lists only visible products with a photo, in the admin order, never a deleted one', function () {
    $second = shopProduct(['sort' => 2, 'title' => 'Zweites']);
    $first = shopProduct(['sort' => 1, 'title' => 'Erstes']);
    ShopProduct::factory()->create(['visible' => false]);
    ShopProduct::factory()->create(['visible' => true]);
    shopProduct(['sort' => 3])->delete();

    $this->getJson('/api/v1/shop/products')->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $first->id)->assertJsonPath('data.1.id', $second->id);
});

it('answers 404 shop_product_unavailable for an unknown, hidden, photo-less or deleted product, by id and by slug', function (string $state) {
    $product = match ($state) {
        'unknown' => null,
        'hidden' => ShopProduct::factory()->has(ShopProductImage::factory(), 'images')->create(['slug' => 'versteckt']),
        'without photo' => ShopProduct::factory()->create(['slug' => 'ohne-foto', 'visible' => true]),
        'deleted' => tap(shopProduct(['slug' => 'geloescht']))->delete(),
    };

    foreach ($product === null ? ['01jzzzzzzzzzzzzzzzzzzzzzzz', 'gibt-es-nicht'] : [$product->id, $product->slug] as $key) {
        $this->getJson("/api/v1/shop/products/$key")->assertNotFound()->assertJsonPath('code', 'shop_product_unavailable')
            ->assertJsonPath('message', 'Dieses Produkt gibt es im Shop nicht mehr.');
    }
})->with(['unknown', 'hidden', 'without photo', 'deleted']);

it('shows samples only while editorial_samples is on, in lists, counts, the hero and the detail', function () {
    shopOpenCategories();
    $sample = shopProduct(['is_sample' => true, 'slug' => 'beispiel']);
    shopProduct(['category' => ShopCategory::Apparel]);
    ShopBanner::factory()->active()->create(['is_sample' => true]);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.categories.0.count', 2)->assertJsonPath('data.hero.is_sample', true);
    $this->getJson('/api/v1/shop/products/beispiel')->assertOk()->assertJsonPath('data.is_sample', true);

    shopFlags(['editorial_samples' => false]);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.hero', null)
        ->assertJsonPath('data.categories', [
            ['key' => 'all', 'label' => 'Alle', 'count' => 1, 'status' => 'available'], ['key' => 'sticker', 'label' => 'Sticker', 'count' => 0, 'status' => 'available'],
            ['key' => 'apparel', 'label' => 'Kleidung', 'count' => 1, 'status' => 'available'], ['key' => 'accessories', 'label' => 'Accessoires', 'count' => 0, 'status' => 'available'],
        ]);
    $this->getJson('/api/v1/shop/products')->assertOk()->assertJsonCount(1, 'data');
    $this->getJson("/api/v1/shop/products/{$sample->id}")->assertNotFound()->assertJsonPath('code', 'shop_product_unavailable');
});

it('filters by category with real counts and labels in the reader language', function () {
    shopOpenCategories();
    shopProduct(['category' => ShopCategory::Sticker]);
    shopProduct(['category' => ShopCategory::Sticker]);
    $cap = shopProduct(['category' => ShopCategory::Accessories]);

    $this->getJson('/api/v1/shop', ['Accept-Language' => 'en'])->assertOk()->assertJsonPath('data.categories', [
        ['key' => 'all', 'label' => 'All', 'count' => 3, 'status' => 'available'], ['key' => 'sticker', 'label' => 'Stickers', 'count' => 2, 'status' => 'available'],
        ['key' => 'apparel', 'label' => 'Apparel', 'count' => 0, 'status' => 'available'], ['key' => 'accessories', 'label' => 'Accessories', 'count' => 1, 'status' => 'available'],
    ]);
    $this->getJson('/api/v1/shop/products?category=accessories')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $cap->id)
        ->assertJsonPath('data.0.category', ['key' => 'accessories', 'label' => 'Accessoires']);
    $this->getJson('/api/v1/shop/products?category=apparel')->assertOk()->assertJsonCount(0, 'data');
});

it('pages with cursors and refuses a bad query', function () {
    foreach (range(1, 5) as $sort) {
        shopProduct(['sort' => $sort, 'title' => "Produkt $sort"]);
    }

    $first = $this->getJson('/api/v1/shop/products?per_page=2')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.per_page', 2)
        ->assertJsonPath('meta.prev_cursor', null)->assertJsonPath('data.0.title', 'Produkt 1');
    $cursor = $first->json('meta.next_cursor');
    expect($cursor)->toBeString()->and($first->json('links.next'))->toContain('cursor=');

    $this->getJson('/api/v1/shop/products?per_page=2&cursor='.$cursor)->assertOk()->assertJsonPath('data.0.title', 'Produkt 3');

    foreach (['category=hats', 'per_page=0', 'per_page=49', 'cursor=bm9wZQ'] as $query) {
        $this->getJson("/api/v1/shop/products?$query")->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
    }
});

it('formats the gross price per locale and never adds anything to it', function () {
    shopProduct(['slug' => 'hoodie', 'price_cents' => 123456]);

    $this->getJson('/api/v1/shop/products/hoodie')->assertOk()->assertJsonPath('data.price', [
        'amount_cents' => 123456, 'currency' => 'EUR', 'formatted' => "1.234,56\u{00A0}€", 'vat_included' => true,
    ]);
    $this->getJson('/api/v1/shop/products/hoodie', ['Accept-Language' => 'en'])->assertOk()->assertJsonPath('data.price.formatted', '€1,234.56');
});

it('builds the buy links on the server: product page, cart permalink per variant, informational chips', function () {
    shopProduct([
        'slug' => 'hoodie',
        'shopify_url' => 'https://'.SHOP_STORE.'/products/club-hoodie',
        'variants' => [
            ['id' => 'aaaa1111', 'label' => 'M', 'shopify_variant_id' => '44112233445566'],
            ['id' => 'bbbb2222', 'label' => 'L', 'shopify_variant_id' => null],
        ],
    ]);

    $response = $this->getJson('/api/v1/shop/products/hoodie')->assertOk()
        ->assertJsonPath('data.buy', ['available' => true, 'kind' => 'external', 'url' => 'https://'.SHOP_STORE.'/products/club-hoodie', 'path' => null, 'reason' => null, 'message' => null])
        ->assertJsonPath('data.variants.0.buy.url', 'https://'.SHOP_STORE.'/cart/44112233445566:1?storefront=true')
        ->assertJsonPath('data.variants.1.buy.url', 'https://'.SHOP_STORE.'/products/club-hoodie')
        ->assertJsonPath('data.variant_kind', ['key' => 'size', 'label' => 'Größe'])
        ->assertJsonPath('data.store', ['configured' => true, 'host' => SHOP_STORE, 'shipping_url' => 'https://'.SHOP_STORE.'/policies/shipping-policy']);

    expect($response->json('data.purchase_mode'))->toBe('shopify');
});

it('says "Bald im Shop erhältlich" instead of a link without a store, without a URL or for a host taken out of the config', function (string $case) {
    $url = 'https://'.SHOP_EXTRA.'/products/club-cap';
    shopProduct(['slug' => 'cap', 'shopify_url' => $case === 'no url' ? null : $url, 'variants' => [['id' => 'cccc3333', 'label' => 'One size', 'shopify_variant_id' => '123']]]);

    match ($case) {
        'no store' => shopStore(null, null),
        'host removed' => shopStore(SHOP_STORE, null),
        default => null,
    };

    $unavailable = ['available' => false, 'kind' => null, 'url' => null, 'path' => null, 'reason' => 'not_configured', 'message' => 'Bald im Shop erhältlich'];
    $this->getJson('/api/v1/shop/products/cap')->assertOk()->assertJsonPath('data.buy', $unavailable)->assertJsonPath('data.variants.0.buy', $unavailable);
})->with(['no url', 'no store', 'host removed']);

it('sends the Car-Sticker through the designer, whatever the variants say', function () {
    shopProduct(['slug' => 'car-sticker', 'purchase_mode' => 'sticker_designer', 'shopify_url' => 'https://'.SHOP_STORE.'/products/car-sticker',
        'variants' => [['id' => 'dddd4444', 'label' => 'S', 'shopify_variant_id' => '999']]]);

    $designer = ['available' => true, 'kind' => 'designer', 'url' => null, 'path' => '/stickers', 'reason' => null, 'message' => null];
    $this->getJson('/api/v1/shop/products/car-sticker')->assertOk()->assertJsonPath('data.buy', $designer)->assertJsonPath('data.variants.0.buy', $designer);
});

it('gives the card and the detail the contract shape, with 4:5 photo variants and no private original', function () {
    $product = shopProduct(['slug' => 'set', 'description' => "Zeile eins.\n\nZeile zwei."]);

    $card = $this->getJson('/api/v1/shop/products')->assertOk()->json('data.0');
    expect(array_keys($card))->toBe(['id', 'slug', 'title', 'category', 'price', 'image', 'purchase_mode', 'is_sample'])
        ->and(array_keys($card['image']))->toBe(['id', 'width', 'height', 'aspect', 'blurhash', 'thumbhash', 'focal_x', 'focal_y', 'alt', 'variants'])
        ->and($card['image']['aspect'])->toBe('4:5')
        ->and(array_column($card['image']['variants'], 'width'))->toBe([320, 640, 1080, 1600])
        ->and($card['image']['variants'][0]['height'])->toBe(400);

    $detail = $this->getJson('/api/v1/shop/products/'.$product->id)->assertOk()->json('data');
    expect(array_keys($detail))->toBe([...array_keys($card), 'description', 'images', 'variant_kind', 'variants', 'buy', 'store'])
        ->and($detail['description'])->toBe("Zeile eins.\n\nZeile zwei.")
        ->and(json_encode($detail))->not->toContain('originals');
});

it('shows the active banner as hero while what it links to can be shown', function () {
    $product = shopProduct(['slug' => 'car-sticker']);
    $banner = ShopBanner::factory()->active()->create(['link_kind' => ShopBannerLink::Product, 'shop_product_id' => $product->id, 'category' => null, 'title' => 'Neu im Shop']);
    ShopBanner::factory()->create(['title' => 'Inaktiv']);

    $this->getJson('/api/v1/shop')->assertOk()
        ->assertJsonPath('data.hero.id', $banner->id)
        ->assertJsonPath('data.hero.title', 'Neu im Shop')
        ->assertJsonPath('data.hero.image.aspect', '16:9')
        ->assertJsonPath('data.hero.link', ['kind' => 'product', 'category' => null, 'product' => ['id' => $product->id, 'slug' => 'car-sticker']]);

    $product->forceFill(['visible' => false])->save();
    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.hero', null);
});

it('answers with an ETag and 304 for the same shop', function () {
    shopProduct();

    $etag = $this->getJson('/api/v1/shop/products')->assertOk()->headers->get('ETag');
    expect($etag)->toBeString();

    $this->getJson('/api/v1/shop/products', ['If-None-Match' => $etag])->assertStatus(304);
});

it('falls back to the local catalogue while the Shopify driver is not configured, and answers 503 while it is only a stub', function () {
    shopProduct();
    config(['speedclub.shop.driver' => 'shopify', 'speedclub.shop.shopify.storefront_token' => null]);
    expect(app(ShopCatalogue::class)->driver())->toBe('local');
    $this->getJson('/api/v1/shop/products')->assertOk()->assertJsonCount(1, 'data');

    config(['speedclub.shop.shopify.storefront_token' => 'storefront-test-token']);
    expect(app(ShopCatalogue::class)->driver())->toBe('shopify');

    foreach (['/api/v1/shop', '/api/v1/shop/products', '/api/v1/shop/products/irgendwas'] as $uri) {
        $this->getJson($uri)->assertStatus(503)->assertJsonPath('code', 'shop_unavailable')->assertHeader('Retry-After', '60');
    }
});

it('opens a product whose slug is one 26-letter word, which looks like a ULID (review SF-2)', function () {
    $slug = 'abcdefghijklmnopqrstuvwxyz';
    $product = shopProduct(['slug' => $slug]);

    $this->getJson("/api/v1/shop/products/$slug")->assertOk()->assertJsonPath('data.id', $product->id);
    $this->getJson('/api/v1/shop/products/'.$product->id)->assertOk()->assertJsonPath('data.slug', $slug);
});

it('shows no hero that leads to an empty category', function () {
    shopOpenCategories();
    ShopBanner::factory()->active()->create(['category' => ShopCategory::Apparel]);
    shopProduct(['category' => ShopCategory::Sticker]);

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.hero', null);

    shopProduct(['category' => ShopCategory::Apparel]);
    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.hero.link.category', 'apparel');
});
