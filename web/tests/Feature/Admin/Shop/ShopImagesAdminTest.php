<?php

use App\Models\AuditEvent;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Shop/ShopTestHelpers.php';

/**
 * ADM-66 product photos (M5.5, m5.5-contract §1, §5) under the media rules: type by content, size and pixel limits, the 4:5 crop of a
 * source large enough, re-encoded (EXIF/GPS gone) with a private original and public WebP variants, at most 8, a new focal point
 * re-crops from the original, order, removal (files gone, a visible product keeps one). Every change audited.
 */
beforeEach(function () {
    // Symfony's test requests send Accept-Language en-us unless told otherwise.
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopStore();
    shopFakeDisks();
    seedStaffRoles();
    actingAsStaff(staffWithRole('content_editor'));
    $this->product = ShopProduct::factory()->create();
    $this->upload = fn (string $bytes, array $data = [], string $name = 'foto.jpg') => $this->post(
        "/admin/shop/products/{$this->product->id}/images", ['file' => shopUpload($bytes, $name), ...$data], ['Accept' => 'application/json']
    );
});

it('re-encodes an upload: EXIF gone, 4:5 crop, private original, public WebP variants, blurhash, audited', function () {
    $response = ($this->upload)(shopJpeg(2000, 2000), ['alt' => 'Hoodie von vorn'])->assertCreated();
    $image = ShopProductImage::query()->findOrFail($response->json('id'));

    expect($image->width)->toBe(1600)->and($image->height)->toBe(2000)
        ->and([$image->original_width, $image->original_height])->toBe([2000, 2000])
        ->and(array_keys($image->variants))->toBe([320, 640, 1080, 1600])
        ->and($image->blurhash)->not->toBeEmpty()
        ->and($image->alt)->toBe('Hoodie von vorn');

    $public = Storage::disk(config()->string('speedclub.shop.disk'));
    $private = Storage::disk(config()->string('speedclub.shop.private_disk'));

    expect($private->exists($image->original_path))->toBeTrue()->and($public->exists($image->original_path))->toBeFalse()
        ->and($private->get($image->original_path))->not->toContain('SECRET')->not->toContain('Exif');

    foreach ($image->variants as $width => $path) {
        expect($public->exists($path))->toBeTrue()->and($public->get($path))->not->toContain('SECRET')->and(str_ends_with($path, '.webp'))->toBeTrue();
        [$w, $h] = getimagesizefromstring((string) $public->get($path)) ?: [0, 0];
        expect($w * 5)->toBe($h * 4);
    }

    $event = AuditEvent::query()->where('action', 'shop.image_added')->sole();
    expect($event->after)->toMatchArray(['image' => $image->id, 'width' => 1600, 'height' => 2000])
        ->and(json_encode($event->after))->not->toContain('shop/');
});

it('refuses what is not an image, a source too small for the 4:5 crop and a ninth photo', function () {
    ($this->upload)('Kein Bild.', [], 'foto.jpg')->assertUnprocessable()->assertJsonValidationErrors('file');
    ($this->upload)('<svg xmlns="http://www.w3.org/2000/svg"></svg>', [], 'foto.svg')->assertUnprocessable()->assertJsonValidationErrors('file');
    ($this->upload)(shopJpeg(1600, 1200))->assertUnprocessable()->assertJsonValidationErrors(['file' => '1080 × 1350']);

    ShopProductImage::factory()->count(8)->create(['shop_product_id' => $this->product->id]);
    ($this->upload)(shopJpeg(1200, 1500))->assertUnprocessable()->assertJsonValidationErrors(['file' => 'höchstens 8 Fotos']);

    expect(ShopProductImage::query()->count())->toBe(8)
        ->and(Storage::disk(config()->string('speedclub.shop.disk'))->allFiles())->toBe([]);
});

it('re-crops from the private original for a new focal point and removes the old variants', function () {
    $id = ($this->upload)(shopJpeg(3000, 2000))->assertCreated()->json('id');
    $image = ShopProductImage::query()->findOrFail($id);
    $old = $image->variants;

    $this->patchJson("/admin/shop/products/{$this->product->id}/images/{$id}", ['focal_x' => 1, 'alt' => 'Rechts'])->assertOk();
    $image->refresh();

    $public = Storage::disk(config()->string('speedclub.shop.disk'));
    expect($image->variants)->not->toBe($old)->and($image->alt)->toBe('Rechts')->and($image->width)->toBe(1600);
    foreach ($old as $path) {
        expect($public->exists($path))->toBeFalse();
    }

    $event = AuditEvent::query()->where('action', 'shop.image_updated')->sole();
    expect($event->before['focal_x'])->toBe(0.5)->and($event->after['focal_x'])->toEqual(1.0);
});

it('reorders the photos of a product and refuses another set', function () {
    $a = ShopProductImage::factory()->create(['shop_product_id' => $this->product->id, 'sort' => 1]);
    $b = ShopProductImage::factory()->create(['shop_product_id' => $this->product->id, 'sort' => 2]);
    $foreign = ShopProductImage::factory()->create();

    $this->postJson("/admin/shop/products/{$this->product->id}/images/reorder", ['ids' => [$b->id, $foreign->id]])->assertUnprocessable();
    $this->postJson("/admin/shop/products/{$this->product->id}/images/reorder", ['ids' => [$b->id, $a->id]])->assertOk();

    expect([$b->refresh()->sort, $a->refresh()->sort])->toBe([1, 2])
        ->and(AuditEvent::query()->where('action', 'shop.images_reordered')->count())->toBe(1);
});

it('removes a photo with its files, but never the last one of a visible product', function () {
    $id = ($this->upload)(shopJpeg(1200, 1500))->assertCreated()->json('id');
    $image = ShopProductImage::query()->findOrFail($id);
    $this->product->forceFill(['visible' => true, 'purchase_mode' => 'sticker_designer'])->save();

    $this->deleteJson("/admin/shop/products/{$this->product->id}/images/{$id}")->assertUnprocessable()->assertJsonValidationErrors('image');

    $this->product->forceFill(['visible' => false])->save();
    $this->deleteJson("/admin/shop/products/{$this->product->id}/images/{$id}")->assertOk();

    expect(ShopProductImage::query()->count())->toBe(0)
        ->and(Storage::disk(config()->string('speedclub.shop.disk'))->allFiles())->toBe([])
        ->and(Storage::disk(config()->string('speedclub.shop.private_disk'))->exists($image->original_path))->toBeFalse()
        ->and(AuditEvent::query()->where('action', 'shop.image_removed')->count())->toBe(1);
});

it('answers 404 for a photo of another product', function () {
    $foreign = ShopProductImage::factory()->create();

    $this->patchJson("/admin/shop/products/{$this->product->id}/images/{$foreign->id}", ['alt' => 'x'])->assertNotFound();
    $this->deleteJson("/admin/shop/products/{$this->product->id}/images/{$foreign->id}")->assertNotFound();
});
