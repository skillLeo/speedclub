<?php

use App\Actions\Shop\PurgeDeletedShopProducts;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Shop/ShopTestHelpers.php';

/**
 * M5.5 review MF-1: every stored shop file belongs to exactly one row. The same photo uploaded twice, or used for a banner and a product,
 * gets its own files (a fresh ULID per write, under shop/{product}/ and shop/banners/), so removing, replacing or purging one row never
 * takes another row's photo; and delete() keeps any file a row still names (rows written before the rule may share files).
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
    shopFakeDisks();
    seedStaffRoles();
    actingAsStaff(staffWithRole('content_editor'));
    $this->withSession(['auth.password_confirmed_at' => time()]);
    $this->photo = shopJpeg(3000, 2000);
});

function shopFilesUpload(ShopProduct $product, string $bytes): ShopProductImage
{
    $id = test()->post("/admin/shop/products/{$product->id}/images", ['file' => shopUpload($bytes)], ['Accept' => 'application/json'])->assertCreated()->json('id');

    return ShopProductImage::query()->findOrFail($id);
}

/** @param array<int|string, string> $variants */
function shopFilesExist(array $variants, string $original): bool
{
    foreach ($variants as $path) {
        if (! Storage::disk(config()->string('speedclub.shop.disk'))->exists($path)) {
            return false;
        }
    }

    return Storage::disk(config()->string('speedclub.shop.private_disk'))->exists($original);
}

it('names every file after its own write, under the product or banners folder', function () {
    $product = ShopProduct::factory()->create();
    $a = shopFilesUpload($product, $this->photo);
    $b = shopFilesUpload($product, $this->photo);

    expect($a->original_path)->not->toBe($b->original_path)
        ->and(array_values($a->variants))->not->toContain(...array_values($b->variants))
        ->and(array_values($a->variants)[0])->toStartWith("shop/{$product->id}/")
        ->and($a->original_path)->toMatch('#\Ashop/originals/[0-9a-z]{26}\.jpg\z#');

    $banner = $this->post('/admin/shop/banners', ['file' => shopUpload($this->photo), 'title' => 'Banner', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json'])->assertCreated()->json('id');
    expect(array_values(ShopBanner::query()->findOrFail($banner)->variants)[0])->toStartWith('shop/banners/');
});

it('keeps the other photo when one of two uploads of the same file is removed, in one product or in two', function (bool $sameProduct) {
    $first = ShopProduct::factory()->create();
    $second = $sameProduct ? $first : ShopProduct::factory()->create();
    $a = shopFilesUpload($first, $this->photo);
    $b = shopFilesUpload($second, $this->photo);

    $this->deleteJson("/admin/shop/products/{$first->id}/images/{$a->id}")->assertOk();

    expect(shopFilesExist($b->variants, $b->original_path))->toBeTrue()
        ->and(shopFilesExist($a->variants, $a->original_path))->toBeFalse();
})->with(['same product' => [true], 'two products' => [false]]);

it('keeps the product photo when a banner made from the same photo is deleted, and the product photo still re-crops', function () {
    $product = ShopProduct::factory()->create();
    $image = shopFilesUpload($product, $this->photo);
    $banner = $this->post('/admin/shop/banners', ['file' => shopUpload($this->photo), 'title' => 'Banner', 'link_kind' => 'category', 'category' => 'sticker'], ['Accept' => 'application/json'])->assertCreated()->json('id');

    $this->deleteJson("/admin/shop/banners/{$banner}")->assertOk();

    expect(shopFilesExist($image->variants, $image->original_path))->toBeTrue();
    $this->patchJson("/admin/shop/products/{$product->id}/images/{$image->id}", ['focal_x' => 0.9])->assertOk();
});

it('keeps a live product photo when shop:purge removes a deleted product with the same photo', function () {
    $live = ShopProduct::factory()->create();
    $gone = ShopProduct::factory()->create();
    $kept = shopFilesUpload($live, $this->photo);
    $purged = shopFilesUpload($gone, $this->photo);
    $gone->delete();
    $gone->forceFill(['deleted_at' => now()->subDays(31)])->saveQuietly();

    $this->artisan('shop:purge')->assertSuccessful();

    expect(ShopProduct::withTrashed()->find($gone->id))->toBeNull()
        ->and(shopFilesExist($kept->variants, $kept->original_path))->toBeTrue()
        ->and(shopFilesExist($purged->variants, $purged->original_path))->toBeFalse();
});

it('never deletes a file another row still names (rows written before the rule may share files)', function (string $how) {
    $live = ShopProduct::factory()->create();
    $other = ShopProduct::factory()->create();
    $shared = shopFilesUpload($live, $this->photo);
    // A row of the old naming that points at the very same files.
    $twin = ShopProductImage::factory()->create([
        'shop_product_id' => $other->id, 'variants' => $shared->variants, 'original_path' => $shared->original_path,
    ]);

    match ($how) {
        'remove' => $this->deleteJson("/admin/shop/products/{$other->id}/images/{$twin->id}")->assertOk(),
        'purge' => (function () use ($other): void {
            $other->delete();
            $other->forceFill(['deleted_at' => now()->subDays(31)])->saveQuietly();
            $this->artisan('shop:purge')->assertSuccessful();
        })(),
    };

    expect(ShopProductImage::query()->find($twin->id))->toBeNull()
        ->and(shopFilesExist($shared->variants, $shared->original_path))->toBeTrue();
})->with(['remove', 'purge']);

it('leaves a product restored after the purge read alone, and restores it at the end of the order', function () {
    $a = ShopProduct::factory()->create(['sort' => 1]);
    $b = ShopProduct::factory()->create(['sort' => 2]);
    $this->deleteJson("/admin/shop/products/{$a->id}")->assertOk();
    $c = ShopProduct::factory()->create(['sort' => 3]);

    $this->postJson("/admin/shop/products/{$a->id}/restore")->assertOk();

    expect($a->refresh()->sort)->toBe(4)->and($b->refresh()->sort)->toBe(2)->and($c->sort)->toBe(3);
    expect(app(PurgeDeletedShopProducts::class)->handle())->toBe(0);
});

it('keeps the stored product of a banner when a PATCH sends an empty product id', function () {
    $product = ShopProduct::factory()->create();
    $banner = ShopBanner::factory()->create(['link_kind' => 'product', 'shop_product_id' => $product->id, 'category' => null]);

    $this->patchJson("/admin/shop/banners/{$banner->id}", ['product_id' => null, 'title' => 'Neuer Titel'])->assertOk();

    expect($banner->refresh()->shop_product_id)->toBe($product->id)->and($banner->title)->toBe('Neuer Titel');
});
