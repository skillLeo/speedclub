<?php

use App\Enums\ShopCategory;
use App\Models\ShopBanner;
use App\Models\ShopProduct;
use App\Models\ShopProductImage;
use Database\Seeders\ShopSampleSeeder;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/ShopTestHelpers.php';

/**
 * M5.5 samples (m5.5-contract §7): three badged sticker products, no clothing or accessories sample, a hero of a sticker on a car, no store
 * link. DQ-P5-002: each leads with photographs of the sticker in use (the server's own drawing on STK-05's licensed "am Auto" photos),
 * the drawings follow; all through the real pipeline, 4:5. A second run changes nothing; a host with the old drawing-only images gets
 * them replaced, staff products untouched. DQ-P5-040: the tile (first image) is a close crop on the sticker on the car where the photo's
 * own pixels allow it, the wider shot second.
 */
it('seeds honest, badged sticker samples and a licensed hero once', function () {
    $this->withHeader('Accept-Language', 'de');
    shopFlags();
    shopFakeDisks();

    $this->seed(ShopSampleSeeder::class);

    $products = ShopProduct::query()->orderBy('sort')->get();
    expect($products->pluck('slug')->all())->toBe(['car-sticker', 'schriftzug-banner', 'round-badge'])
        ->and($products->every(fn (ShopProduct $product): bool => $product->is_sample && $product->visible && $product->shopify_url === null))->toBeTrue()
        ->and($products->every(fn (ShopProduct $product): bool => $product->category === ShopCategory::Sticker))->toBeTrue()
        ->and($products->first()?->purchase_mode->value)->toBe('sticker_designer')
        ->and(ShopProductImage::query()->count())->toBe(13)
        ->and(ShopProductImage::query()->where('sort', 1)->pluck('alt')->every(fn (string $alt): bool => str_contains($alt, ' an der ') || str_contains($alt, ' auf dem ')))->toBeTrue()
        ->and(ShopProductImage::query()->get()->every(fn (ShopProductImage $image): bool => $image->width * 5 === $image->height * 4))->toBeTrue();

    $alts = fn (string $slug): array => ShopProductImage::query()->whereBelongsTo($products->firstWhere('slug', $slug), 'product')->orderBy('sort')->pluck('alt')->all();
    foreach (['car-sticker' => 8, 'schriftzug-banner' => 3] as $slug => $count) {
        $list = $alts($slug);
        expect($list)->toHaveCount($count)
            ->and($list[0])->toStartWith('Nahaufnahme: ')
            ->and($list[1])->toBe(str($list[0])->after('Nahaufnahme: ')->toString());
    }
    expect($alts('round-badge'))->toHaveCount(2);

    // R4DQ-13/57: the hero is a sticker on a car (the licensed RS3 photo at its full width and native pixels), 16:9, its focal point the
    // sticker, with its own blurhash.
    $banner = ShopBanner::query()->sole();
    expect($banner->is_sample)->toBeTrue()->and($banner->active)->toBeTrue()
        ->and($banner->alt)->toBe('Sticker-Vorlage Classic mit Platzhaltertext an der getönten Heckscheibe eines blauen Audi RS3 Sportback')
        ->and([$banner->width, $banner->height])->toBe([1600, 900])
        ->and([round($banner->focal_x, 2), round($banner->focal_y, 2)])->toBe([0.8, 0.7])
        ->and($banner->blurhash)->not->toBeEmpty()
        ->and($banner->thumbhash)->toBeNull();

    $this->getJson('/api/v1/shop')->assertOk()->assertJsonPath('data.categories.2.count', 0)->assertJsonPath('data.hero.is_sample', true);

    $ids = ShopProductImage::query()->orderBy('id')->pluck('id')->all();
    $this->seed(ShopSampleSeeder::class);
    expect(ShopProduct::query()->count())->toBe(3)->and(ShopBanner::query()->count())->toBe(1)
        ->and(ShopProductImage::query()->orderBy('id')->pluck('id')->all())->toBe($ids);
});

it('replaces old sample images on a host that has the samples, never a staff product\'s', function () {
    shopFlags();
    shopFakeDisks();
    $this->seed(ShopSampleSeeder::class);

    // The images of an earlier seed (drawings only): one row with a file on the disk.
    $sample = ShopProduct::query()->where('slug', 'round-badge')->sole();
    $old = ShopProductImage::query()->where('shop_product_id', $sample->id)->orderBy('sort')->get();
    ShopProductImage::query()->where('shop_product_id', $sample->id)->where('sort', 1)->update(['alt' => 'Zeichnung der Sticker-Vorlage Round mit Platzhaltertext']);
    $staff = ShopProduct::factory()->create(['slug' => 'round-badge-staff', 'is_sample' => false]);
    $staffImage = ShopProductImage::factory()->create(['shop_product_id' => $staff->id]);

    $this->seed(ShopSampleSeeder::class);

    $now = ShopProductImage::query()->where('shop_product_id', $sample->id)->orderBy('sort')->get();
    expect($now)->toHaveCount(2)
        ->and(array_intersect($now->modelKeys(), $old->modelKeys()))->toBe([])
        ->and($now->first()?->alt)->toContain('Audi RS3')
        ->and(ShopProductImage::query()->find($staffImage->id))->not->toBeNull();

    foreach ($old as $image) {
        foreach ((array) $image->variants as $path) {
            expect(Storage::disk(config()->string('speedclub.shop.disk'))->exists((string) $path))->toBeFalse();
        }
    }
});

it('replaces the old sample hero (office towers) with the sticker on a car, never a banner staff made (R4DQ-13)', function () {
    shopFlags();
    shopFakeDisks();
    $this->seed(ShopSampleSeeder::class);

    // Staging's hero of an earlier seed: the night-city photo, with its files on the disk.
    $old = ShopBanner::query()->sole();
    $old->forceFill(['alt' => 'Hochhausschlucht in Tokio bei Nacht'])->save();
    $staff = ShopBanner::factory()->create(['is_sample' => false, 'alt' => 'Team-Banner']);

    $this->seed(ShopSampleSeeder::class);

    $sample = ShopBanner::query()->where('is_sample', true)->sole();
    expect($sample->id)->not->toBe($old->id)
        ->and($sample->alt)->toContain('Audi RS3')
        ->and(ShopBanner::query()->find($staff->id))->not->toBeNull();

    foreach ((array) $old->variants as $path) {
        expect(Storage::disk(config()->string('speedclub.shop.disk'))->exists((string) $path))->toBeFalse();
    }

    // A further run keeps the new hero.
    $this->seed(ShopSampleSeeder::class);
    expect(ShopBanner::query()->where('is_sample', true)->sole()->id)->toBe($sample->id);
});

it('draws the hero from a native-size frame above the photo\'s pixelated plate and replaces a hero drawn from another frame (R4DQ-49, R4DQ-57)', function () {
    $hero = (new ReflectionClassConstant(ShopSampleSeeder::class, 'HERO'))->getValue();
    $mockups = (new ReflectionClassConstant(ShopSampleSeeder::class, 'MOCKUPS'))->getValue();
    $file = $mockups[$hero['mockup']]['file'];
    [$photoW, $photoH] = getimagesize(base_path('../design/seed-photos/'.$file));
    $plates = json_decode((string) file_get_contents(database_path('data/showcase/plates.json')), true)['photos'][$file]['regions'];
    [$left, $top, $width] = $hero['region'];
    $bottom = $top + $width * $hero['size'][1] / $hero['size'][0];

    // R4DQ-57: never scaled up: the region is as wide as the hero, the photo's full width.
    expect($width)->toBe($hero['size'][0])->and($left + $width)->toBeLessThanOrEqual($photoW);

    foreach ($plates as $plate) {
        $overlapsX = $left < ($plate['x'] + $plate['w']) * $photoW && $left + $width > $plate['x'] * $photoW;
        expect($overlapsX && $bottom > $plate['y'] * $photoH)->toBeFalse();
    }

    shopFlags();
    shopFakeDisks();
    $this->seed(ShopSampleSeeder::class);

    // The R4DQ-13 hero had the same picture description, drawn from a frame that reached the plate: other bytes.
    $old = ShopBanner::query()->sole();
    $old->forceFill(['sha256' => hash('sha256', 'earlier frame')])->save();
    $this->seed(ShopSampleSeeder::class);

    expect(ShopBanner::query()->where('is_sample', true)->sole()->id)->not->toBe($old->id);
});

it('gives a host with the round-1 images the close tile first (DQ-P5-040)', function () {
    shopFlags();
    shopFakeDisks();
    $this->seed(ShopSampleSeeder::class);

    // Round 1 led with the wide Classic shot on the Mercedes.
    $sample = ShopProduct::query()->where('slug', 'car-sticker')->sole();
    ShopProductImage::query()->where('shop_product_id', $sample->id)->where('sort', 1)
        ->update(['alt' => 'Sticker-Vorlage Classic mit Platzhaltertext an der Heckscheibe eines grauen Mercedes-AMG A 45 S in der Dämmerung']);

    $this->seed(ShopSampleSeeder::class);

    $now = ShopProductImage::query()->where('shop_product_id', $sample->id)->orderBy('sort')->get();
    expect($now)->toHaveCount(8)
        ->and($now->pluck('sort')->all())->toBe(range(1, 8))
        ->and($now[0]->alt)->toStartWith('Nahaufnahme: ')->toContain('Nissan 350Z')
        ->and($now[1]->alt)->not->toStartWith('Nahaufnahme')->toContain('Nissan 350Z')
        ->and($now[4]->alt)->toStartWith('Zeichnung der Sticker-Vorlage');
});
