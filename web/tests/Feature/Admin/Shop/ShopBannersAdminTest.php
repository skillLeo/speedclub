<?php

use App\Actions\Shop\PurgeDeletedShopProducts;
use App\Models\AuditEvent;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Shop/ShopTestHelpers.php';

/**
 * ADM-67 Shop-Banner (M5.5, m5.5-contract §5): upload (ratio and width rules, re-encoded, not cropped), link to a product or category,
 * one active at a time, edit, delete ⚿ with its files; the page props. Plus the daily purge of deleted products (shop:purge).
 */
beforeEach(function () {
    // Symfony's test requests send Accept-Language en-us unless told otherwise.
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
    shopFakeDisks();
    seedStaffRoles();
    actingAsStaff(staffWithRole('admin'));
    $this->withSession(['auth.password_confirmed_at' => time()]);
});

it('creates an inactive banner from a wide photo, re-encoded and audited, and refuses narrow or odd photos', function () {
    $response = $this->post('/admin/shop/banners', ['file' => shopUpload(shopJpeg(1920, 1080)), 'title' => 'Neu im Shop', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json'])->assertCreated();
    $banner = ShopBanner::query()->findOrFail($response->json('id'));

    expect($banner->active)->toBeFalse()->and([$banner->width, $banner->height])->toBe([1920, 1080])
        ->and(Storage::disk(config()->string('speedclub.shop.private_disk'))->get($banner->original_path))->not->toContain('SECRET')
        ->and(AuditEvent::query()->where('action', 'shop.banner_created')->count())->toBe(1);

    $post = fn (int $w, int $h) => $this->post('/admin/shop/banners', ['file' => shopUpload(shopJpeg($w, $h)), 'title' => 'X Banner', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json']);
    $post(1200, 600)->assertUnprocessable()->assertJsonValidationErrors(['file' => '1600']);
    $post(1600, 2400)->assertUnprocessable()->assertJsonValidationErrors(['file' => '4:5']);
    $post(3000, 1000)->assertUnprocessable()->assertJsonValidationErrors(['file' => '21:9']);
});

it('validates the link', function (array $data, string $field) {
    $this->post('/admin/shop/banners', ['file' => shopUpload(shopJpeg(1920, 1080)), 'title' => 'Banner', ...$data], ['Accept' => 'application/json'])
        ->assertUnprocessable()->assertJsonValidationErrors($field);
    expect(ShopBanner::query()->count())->toBe(0)->and(Storage::disk(config()->string('speedclub.shop.disk'))->allFiles())->toBe([]);
})->with([
    'product without id' => [['link_kind' => 'product'], 'product_id'],
    'deleted product' => [fn () => ['link_kind' => 'product', 'product_id' => tap(ShopProduct::factory()->create())->delete()->id], 'product_id'],
    'category without key' => [['link_kind' => 'category'], 'category'],
    'unknown kind' => [['link_kind' => 'url', 'category' => 'sticker'], 'link_kind'],
]);

it('keeps one banner active, audited, and switches it off again', function () {
    $old = ShopBanner::factory()->active()->create();
    $new = ShopBanner::factory()->create();

    $this->postJson("/admin/shop/banners/{$new->id}/activate")->assertOk()->assertJsonPath('active', true);
    expect($old->refresh()->active)->toBeFalse()->and(ShopBanner::query()->where('active', true)->pluck('id')->all())->toBe([$new->id]);
    expect(AuditEvent::query()->where('action', 'shop.banner_activated')->sole()->after['deactivated'])->toBe([$old->id]);

    $this->postJson("/admin/shop/banners/{$new->id}/deactivate")->assertOk()->assertJsonPath('active', false);
    expect(ShopBanner::query()->where('active', true)->count())->toBe(0);
});

it('edits a banner: link, focal point, a new photo replaces the old files', function () {
    $id = $this->post('/admin/shop/banners', ['file' => shopUpload(shopJpeg(1920, 1080)), 'title' => 'Alt', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json'])->json('id');
    $banner = ShopBanner::query()->findOrFail($id);
    $oldFiles = [...array_values($banner->variants)];
    $product = ShopProduct::factory()->create();

    $this->post("/admin/shop/banners/{$id}", ['_method' => 'PATCH', 'file' => shopUpload(shopJpeg(2400, 1200)), 'title' => 'Neu', 'link_kind' => 'product', 'product_id' => $product->id, 'focal_x' => 0.2], ['Accept' => 'application/json'])->assertOk();
    $banner->refresh();

    expect($banner->title)->toBe('Neu')->and($banner->shop_product_id)->toBe($product->id)->and($banner->category)->toBeNull()
        ->and($banner->width)->toBe(2400)->and($banner->focal_x)->toBe(0.2);
    foreach ($oldFiles as $path) {
        expect(Storage::disk(config()->string('speedclub.shop.disk'))->exists($path))->toBeFalse();
    }

    $event = AuditEvent::query()->where('action', 'shop.banner_updated')->sole();
    expect($event->before['title'])->toBe('Alt')->and($event->after['new_image'])->toBeTrue();
});

it('deletes a banner with its files, audited', function () {
    $id = $this->post('/admin/shop/banners', ['file' => shopUpload(shopJpeg(1920, 1080)), 'title' => 'Weg', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json'])->json('id');

    $this->deleteJson("/admin/shop/banners/{$id}")->assertOk();

    expect(ShopBanner::query()->count())->toBe(0)
        ->and(Storage::disk(config()->string('speedclub.shop.disk'))->allFiles())->toBe([])
        ->and(Storage::disk(config()->string('speedclub.shop.private_disk'))->allFiles())->toBe([])
        ->and(AuditEvent::query()->where('action', 'shop.banner_deleted')->count())->toBe(1);
});

it('gives the banner page its rows with a link check, the product choices and the limits', function () {
    $hidden = ShopProduct::factory()->create(['title' => 'Versteckt', 'sort' => 1]);
    ShopProduct::factory()->listed()->create(['title' => 'Sichtbar', 'sort' => 2]);
    ShopBanner::factory()->active()->create(['link_kind' => 'product', 'shop_product_id' => $hidden->id, 'category' => null]);
    ShopBanner::factory()->create();
    ShopBanner::factory()->create(['category' => 'apparel', 'updated_at' => now()->subDay()]);

    $props = $this->get('/admin/shop/banners')->assertOk()->inertiaProps();

    expect($props['banners'])->toHaveCount(3)
        ->and($props['banners'][2]['link_ok'])->toBeFalse()
        ->and($props['banners'][0]['active'])->toBeTrue()
        ->and($props['banners'][0]['link_ok'])->toBeFalse()
        ->and($props['banners'][0]['link']['product'])->toBe(['id' => $hidden->id, 'title' => 'Versteckt', 'visible' => false])
        ->and($props['banners'][1]['link_ok'])->toBeTrue()
        ->and(array_keys($props['banners'][0]))->toEqualCanonicalizing(['id', 'title', 'subtitle', 'active', 'is_sample', 'link', 'link_ok', 'image', 'updated_at', 'updated_by'])
        ->and($props['products'][0])->toBe(['value' => $hidden->id, 'label' => 'Versteckt', 'visible' => false])
        ->and($props['limits'])->toBe(['min_width' => 1600, 'max_upload_kb' => 15360]);
});

it('purges products deleted more than 30 days ago with their files, and keeps the younger ones', function () {
    $public = Storage::disk(config()->string('speedclub.shop.disk'));
    $old = ShopProduct::factory()->create();
    $image = ShopProductImage::factory()->create(['shop_product_id' => $old->id]);
    foreach ($image->variants as $path) {
        $public->put($path, 'x');
    }
    $old->delete();
    $old->forceFill(['deleted_at' => now()->subDays(31)])->saveQuietly();
    $young = tap(ShopProduct::factory()->create())->delete();
    $kept = ShopProduct::factory()->create();

    $this->artisan('shop:purge')->assertSuccessful();

    expect(ShopProduct::withTrashed()->pluck('id')->all())->toEqualCanonicalizing([$young->id, $kept->id])
        ->and(ShopProductImage::query()->count())->toBe(0)
        ->and($public->allFiles())->toBe([])
        ->and(app(PurgeDeletedShopProducts::class)->handle())->toBe(0);
});
