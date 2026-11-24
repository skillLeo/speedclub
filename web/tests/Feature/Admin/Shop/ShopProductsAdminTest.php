<?php

use App\Models\AuditEvent;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use App\Models\Staff;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Shop/ShopTestHelpers.php';

/**
 * ADM-66 Shop-Produkte (M5.5, m5.5-contract §5): shop.manage (Owner, Admin, Content editor) on every route, everyone else 403; the
 * table and edit page props the admin-builder reads; create hidden at the end, edit with the URL rule, show only when complete, reorder
 * the full set, delete ⚿ (recent password) and restore hidden; every change audited with before/after.
 */
const ADM66_ROLES = ['owner', 'admin', 'content_editor'];

beforeEach(function () {
    // Symfony's test requests send Accept-Language en-us unless told otherwise.
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
});

function adm66As(string $role = 'content_editor', bool $password = true): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);

    if ($password) {
        test()->withSession(['auth.password_confirmed_at' => time()]);
    }

    return $staff;
}

/** @return array<string, mixed> */
function adm66Payload(array $overrides = []): array
{
    return [
        'title' => 'Club Hoodie',
        'category' => 'apparel',
        'price_cents' => 5990,
        'variant_kind' => 'size',
        'variants' => [['label' => 'M', 'shopify_variant_id' => '44112233445566'], ['label' => 'L']],
        'purchase_mode' => 'shopify',
        'shopify_url' => 'https://'.SHOP_STORE.'/products/club-hoodie',
        'description' => "Schwerer Hoodie.\r\n\r\nMit Stick.",
        ...$overrides,
    ];
}

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('lets shop.manage read the pages and refuses every other role', function (string $uri, string $component) {
    $product = ShopProduct::factory()->create();

    // The Vue pages come from the admin-builder round (m5.5-contract §5): until they exist the component file is not checked.
    $pageExists = is_file(resource_path("js/admin/Pages/$component.vue"));

    assertAdminMatrix('GET', str_replace('{product}', $product->id, $uri), ADM66_ROLES, fn (TestResponse $r) => $r->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component($component, $pageExists)->where('canManage', true)));
})->with([
    'list' => ['/admin/shop/products', 'Shop/Products/Index'],
    'new' => ['/admin/shop/products/new', 'Shop/Products/Edit'],
    'edit' => ['/admin/shop/products/{product}', 'Shop/Products/Edit'],
    'banners' => ['/admin/shop/banners', 'Shop/Banners/Index'],
]);

it('guards every write by shop.manage, ahead of the password check', function (string $method, string $uri) {
    $product = ShopProduct::factory()->create();
    $image = ShopProductImage::factory()->create(['shop_product_id' => $product->id]);
    $banner = ShopBanner::factory()->create();
    $uri = str_replace(['{product}', '{image}', '{banner}'], [$product->id, $image->id, $banner->id], $uri);

    assertAdminMatrix($method, $uri, ADM66_ROLES, function (TestResponse $r): void {
        // Allowed roles reach the FormRequest / the password check (no recent password in the matrix): never 403.
        expect($r->status())->not->toBe(403);
    });
})->with([
    ['POST', '/admin/shop/products'],
    ['PATCH', '/admin/shop/products/{product}'],
    ['POST', '/admin/shop/products/{product}/visibility'],
    ['POST', '/admin/shop/products/reorder'],
    ['DELETE', '/admin/shop/products/{product}'],
    ['POST', '/admin/shop/products/{product}/restore'],
    ['POST', '/admin/shop/products/{product}/images'],
    ['PATCH', '/admin/shop/products/{product}/images/{image}'],
    ['POST', '/admin/shop/products/{product}/images/reorder'],
    ['DELETE', '/admin/shop/products/{product}/images/{image}'],
    ['POST', '/admin/shop/banners'],
    ['PATCH', '/admin/shop/banners/{banner}'],
    ['POST', '/admin/shop/banners/{banner}/activate'],
    ['POST', '/admin/shop/banners/{banner}/deactivate'],
    ['DELETE', '/admin/shop/banners/{banner}'],
]);

it('needs a recent password for the two deletes only', function () {
    adm66As(password: false);
    $product = ShopProduct::factory()->create();
    $banner = ShopBanner::factory()->create();

    $this->delete("/admin/shop/products/{$product->id}")->assertRedirect()->assertSessionHas('confirm_password');
    $this->delete("/admin/shop/banners/{$banner->id}")->assertRedirect()->assertSessionHas('confirm_password');
    expect(ShopProduct::query()->count())->toBe(1)->and(ShopBanner::query()->count())->toBe(1);

    $this->postJson('/admin/shop/products', adm66Payload())->assertCreated();
});

// ---- pages ------------------------------------------------------------------------------------------------------------------------

it('gives the table the row shape, the store and the flag', function () {
    adm66As();
    $product = ShopProduct::factory()->listed()->create(['title' => 'Round Badge', 'price_cents' => 790, 'is_sample' => true]);
    ShopProduct::factory()->create(['title' => 'Gelöscht'])->delete();

    $props = $this->get('/admin/shop/products')->assertOk()->inertiaProps();
    expect($props['rows']['data'])->toHaveCount(1)
        ->and(array_keys($props['rows']['data'][0]))->toEqualCanonicalizing(['id', 'slug', 'title', 'category', 'price_cents', 'price', 'visible', 'is_sample',
            'purchase_mode', 'buy_state', 'image', 'images_count', 'variants_count', 'sort', 'deleted_at', 'updated_at', 'updated_by'])
        ->and($props['rows']['data'][0])->toMatchArray(['id' => $product->id, 'price' => "7,90\u{00A0}€", 'buy_state' => 'not_configured', 'images_count' => 1])
        ->and($props['store'])->toMatchArray(['configured' => true, 'host' => SHOP_STORE, 'extra_hosts' => [SHOP_EXTRA], 'driver' => 'local', 'storefront' => 'not_configured'])
        ->and($props['flagOn'])->toBeTrue()
        ->and($props['categories'][1])->toBe(['value' => 'apparel', 'label' => 'Kleidung']);

    $trashed = $this->get('/admin/shop/products?filter[trashed]=only')->assertOk()->inertiaProps();
    expect($trashed['rows']['data'])->toHaveCount(1)->and($trashed['rows']['data'][0]['title'])->toBe('Gelöscht');
});

it('gives the edit page the record, what is missing and the exact member preview', function () {
    adm66As();
    $product = ShopProduct::factory()->has(ShopProductImage::factory(), 'images')->create(['title' => 'Hoodie', 'visible' => false]);

    $props = $this->get("/admin/shop/products/{$product->id}")->assertOk()->inertiaProps();
    expect($props['product']['missing'])->toBe(['shopify_url'])
        ->and($props['product']['images'])->toHaveCount(1)
        ->and($props['preview']['card']['title'])->toBe('Hoodie')
        ->and($props['preview']['detail']['buy']['reason'])->toBe('not_configured')
        ->and($props['limits'])->toMatchArray(['max_images' => 8, 'min_crop' => ['width' => 1080, 'height' => 1350]]);
});

// ---- writes -----------------------------------------------------------------------------------------------------------------------

it('creates a product hidden at the end of the order with a slug, normalised fields and stable variant ids, audited', function () {
    $staff = adm66As();
    ShopProduct::factory()->create(['sort' => 4, 'slug' => 'club-hoodie']);

    $id = $this->postJson('/admin/shop/products', adm66Payload(['reason' => 'Neue Kollektion']))->assertCreated()->json('id');
    $product = ShopProduct::query()->findOrFail($id);

    expect($product->slug)->toBe('club-hoodie-2')
        ->and($product->visible)->toBeFalse()->and($product->is_sample)->toBeFalse()
        ->and($product->sort)->toBe(5)
        ->and($product->description)->toBe("Schwerer Hoodie.\n\nMit Stick.")
        ->and($product->created_by)->toBe($staff->id)
        ->and($product->variantList())->toHaveCount(2)
        ->and($product->variantList()[0]['id'])->toMatch('/\A[0-9a-z]{8}\z/')
        ->and($product->variantList()[1]['shopify_variant_id'])->toBeNull();

    $event = AuditEvent::query()->where('action', 'shop.product_created')->sole();
    expect($event->reason)->toBe('Neue Kollektion')->and($event->after['price_cents'])->toBe(5990)->and($event->after['shopify_url'])->toBe('https://'.SHOP_STORE.'/products/club-hoodie');
});

it('refuses a product URL off the store, with extra parts, or before a store is configured', function (string $url, string $message) {
    adm66As();

    $this->postJson('/admin/shop/products', adm66Payload(['shopify_url' => $url]))->assertUnprocessable()->assertJsonValidationErrors(['shopify_url' => $message]);
    expect(ShopProduct::query()->count())->toBe(0);
})->with([
    'http' => ['http://'.SHOP_STORE.'/products/club-hoodie', 'Gib die Produktadresse'],
    'foreign host' => ['https://evil.example.test/products/club-hoodie', 'Gib die Produktadresse'],
    'any myshopify store' => ['https://other-store.myshopify.com/products/club-hoodie', 'Gib die Produktadresse'],
    'not a product path' => ['https://'.SHOP_STORE.'/collections/all', 'Gib die Produktadresse'],
    'tracking query' => ['https://'.SHOP_STORE.'/products/club-hoodie?utm_source=x', 'Gib die Produktadresse'],
    'fragment' => ['https://'.SHOP_STORE.'/products/club-hoodie#top', 'Gib die Produktadresse'],
    'credentials' => ['https://user:pw@'.SHOP_STORE.'/products/club-hoodie', 'Gib die Produktadresse'],
]);

it('refuses any product URL while no store is configured, and accepts the extra host and ?variant=', function () {
    adm66As();
    shopStore(null, null);
    $this->postJson('/admin/shop/products', adm66Payload())->assertUnprocessable()->assertJsonValidationErrors(['shopify_url' => 'Trag zuerst die Shop-Adresse']);

    shopStore();
    $id = $this->postJson('/admin/shop/products', adm66Payload(['shopify_url' => 'https://'.strtoupper(SHOP_EXTRA).'/products/club-hoodie/?variant=42']))->assertCreated()->json('id');
    expect(ShopProduct::query()->findOrFail($id)->shopify_url)->toBe('https://'.SHOP_EXTRA.'/products/club-hoodie?variant=42');
});

it('validates the product fields', function (array $overrides, string $field) {
    adm66As();

    $this->postJson('/admin/shop/products', adm66Payload($overrides))->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'no title' => [['title' => ''], 'title'],
    'unknown category' => [['category' => 'hats'], 'category'],
    'zero price' => [['price_cents' => 0], 'price_cents'],
    'other currency' => [['currency' => 'USD'], 'currency'],
    'variant id with letters' => [['variants' => [['label' => 'M', 'shopify_variant_id' => 'gid://1']]], 'variants.0.shopify_variant_id'],
    'too many variants' => [['variants' => array_fill(0, 25, ['label' => 'X'])], 'variants'],
    'bad slug' => [['slug' => 'Mit Leerzeichen'], 'slug'],
    'unknown purchase mode' => [['purchase_mode' => 'in_app'], 'purchase_mode'],
]);

it('edits a product with an audit of the changed fields only, keeps variant ids, and never lets a visible one become incomplete', function () {
    adm66As();
    $product = ShopProduct::factory()->listed()->create(['shopify_url' => 'https://'.SHOP_STORE.'/products/a', 'variants' => [['id' => 'keep1234', 'label' => 'M', 'shopify_variant_id' => null]]]);

    $this->patchJson("/admin/shop/products/{$product->id}", ['price_cents' => 2490, 'variants' => [['id' => 'keep1234', 'label' => 'M'], ['label' => 'L']]])->assertOk();
    $product->refresh();
    expect($product->price_cents)->toBe(2490)->and($product->variantList()[0]['id'])->toBe('keep1234');

    $event = AuditEvent::query()->where('action', 'shop.product_updated')->sole();
    expect(array_keys($event->before))->toEqualCanonicalizing(['price_cents', 'variants'])->and($event->before['price_cents'])->toBe(1490);

    $this->patchJson("/admin/shop/products/{$product->id}", ['shopify_url' => null])->assertUnprocessable()->assertJsonValidationErrors('visible');
    expect($product->refresh()->shopify_url)->toBe('https://'.SHOP_STORE.'/products/a');
});

it('shows a product only when complete and hides it again, audited', function () {
    adm66As();
    $product = ShopProduct::factory()->create();

    $this->postJson("/admin/shop/products/{$product->id}/visibility", ['visible' => true])->assertUnprocessable()
        ->assertJsonValidationErrors(['visible' => 'Zum Anzeigen fehlt noch: ein Foto, die Produktadresse im Shop.']);

    ShopProductImage::factory()->create(['shop_product_id' => $product->id]);
    $product->forceFill(['shopify_url' => 'https://'.SHOP_STORE.'/products/x'])->save();

    $this->postJson("/admin/shop/products/{$product->id}/visibility", ['visible' => true, 'reason' => 'Launch'])->assertOk()->assertJsonPath('visible', true);
    $this->postJson("/admin/shop/products/{$product->id}/visibility", ['visible' => false])->assertOk()->assertJsonPath('visible', false);

    expect(AuditEvent::query()->where('action', 'shop.product_shown')->sole()->reason)->toBe('Launch')
        ->and(AuditEvent::query()->where('action', 'shop.product_hidden')->count())->toBe(1);
});

it('lets the designer product and a sample be shown without a store URL', function (array $attributes) {
    adm66As();
    $product = ShopProduct::factory()->has(ShopProductImage::factory(), 'images')->create($attributes);

    $this->postJson("/admin/shop/products/{$product->id}/visibility", ['visible' => true])->assertOk();
})->with(['designer' => [['purchase_mode' => 'sticker_designer']], 'sample' => [['is_sample' => true]]]);

it('reorders the full set of products in one audited step and refuses a partial or foreign list', function () {
    adm66As();
    $a = ShopProduct::factory()->create(['sort' => 1]);
    $b = ShopProduct::factory()->create(['sort' => 2]);
    $c = ShopProduct::factory()->create(['sort' => 3]);
    ShopProduct::factory()->create(['sort' => 4])->delete();

    $this->postJson('/admin/shop/products/reorder', ['ids' => [$a->id, $b->id]])->assertUnprocessable()->assertJsonValidationErrors('ids');
    $this->postJson('/admin/shop/products/reorder', ['ids' => [$c->id, $a->id, '01jzzzzzzzzzzzzzzzzzzzzzzz']])->assertUnprocessable();

    $this->postJson('/admin/shop/products/reorder', ['ids' => [$c->id, $a->id, $b->id]])->assertOk();
    expect([$c->refresh()->sort, $a->refresh()->sort, $b->refresh()->sort])->toBe([1, 2, 3]);

    $event = AuditEvent::query()->where('action', 'shop.products_reordered')->sole();
    expect($event->before['order'])->toBe([$a->id, $b->id, $c->id])->and($event->after['order'])->toBe([$c->id, $a->id, $b->id]);
});

it('deletes softly with a recent password, hides the hero that links it, and restores the product hidden', function () {
    adm66As();
    $product = ShopProduct::factory()->listed()->create(['shopify_url' => 'https://'.SHOP_STORE.'/products/x', 'slug' => 'weg']);
    ShopBanner::factory()->active()->create(['link_kind' => 'product', 'shop_product_id' => $product->id, 'category' => null]);
    $this->getJson('/api/v1/shop')->assertJsonPath('data.hero.link.product.id', $product->id);

    $this->deleteJson("/admin/shop/products/{$product->id}", ['reason' => 'Ausverkauft'])->assertOk();
    expect(ShopProduct::withTrashed()->findOrFail($product->id)->trashed())->toBeTrue();
    $this->getJson('/api/v1/shop')->assertJsonPath('data.hero', null);
    $this->getJson('/api/v1/shop/products/weg')->assertNotFound();
    $this->patchJson("/admin/shop/products/{$product->id}", ['title' => 'Neu'])->assertNotFound();

    $props = $this->get("/admin/shop/products/{$product->id}")->assertOk()->inertiaProps();
    expect($props['product']['deleted_at'])->not->toBeNull()->and($props['product']['purge_at'])->not->toBeNull();

    $this->postJson("/admin/shop/products/{$product->id}/restore")->assertOk()->assertJsonPath('visible', false)->assertJsonPath('deleted', false);
    expect(AuditEvent::query()->whereIn('action', ['shop.product_deleted', 'shop.product_restored'])->pluck('action')->all())
        ->toEqualCanonicalizing(['shop.product_deleted', 'shop.product_restored']);
});

it('answers 404 for an unknown product id on every product route', function () {
    adm66As();

    $this->get('/admin/shop/products/01jzzzzzzzzzzzzzzzzzzzzzzz')->assertNotFound();
    $this->patchJson('/admin/shop/products/01jzzzzzzzzzzzzzzzzzzzzzzz', ['title' => 'Neuer Titel'])->assertNotFound();
});
