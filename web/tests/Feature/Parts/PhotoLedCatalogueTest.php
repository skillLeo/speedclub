<?php

use App\Enums\ModerationStatus;
use App\Enums\Visibility;
use App\Models\Brand;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\CatalogHighlights;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Businesses/BusinessTestHelpers.php';

/**
 * ADR-457 / DQ-1138 / DQ-1140: every count shown in the catalogue counts real builds only (never samples, whether shown or not), walls
 * list real builds before samples, product lists sort by real build count, and the photos (product `thumbnail`, `lead_photo`,
 * `build_photos`) come from builds the reader may see, thumbnails from real builds only.
 */
beforeEach(function () {
    bizFlags();
    $this->brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw']);
    $this->category = ModCategory::factory()->create(['key' => 'suspension_photo_test']);
    $this->v3 = Product::factory()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'Variante 3', 'slug' => 'variante-3']);
    $this->v1 = Product::factory()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'Variante 1', 'slug' => 'variante-1']);
    $this->aa = Product::factory()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'AA Erstes', 'slug' => 'aa-erstes']);
});

/** A published sample build (the owner is the editorial sample account) with a mod of $product. */
function photoSampleBuild(Product $product): Modification
{
    $mod = bizBuildWithMod(User::factory()->create(['is_sample' => true]), $product);
    Vehicle::query()->whereKey($mod->vehicle_id)->update(['is_sample' => true]);
    bizRebuild($mod->vehicle);

    return $mod->refresh();
}

function photoCoverId(Modification $mod): string
{
    return (string) Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $mod->vehicle_id)->value('id');
}

it('never counts sample builds, also while samples are shown, and a sample does not change a count', function () {
    $real = bizBuildWithMod(null, $this->v3);
    photoSampleBuild($this->v3);
    photoSampleBuild($this->v3);
    photoSampleBuild($this->v1);

    $this->getJson("/api/v1/products/{$this->v3->id}")->assertOk()->assertJsonPath('data.builds', 1);
    $this->getJson("/api/v1/products/{$this->v1->id}")->assertOk()->assertJsonPath('data.builds', 0);
    $this->getJson('/api/v1/products?counts=1')->assertOk()->assertJsonPath('data.0.id', $this->v3->id)->assertJsonPath('data.0.builds', 1)
        ->assertJsonPath('data.1.builds', 0);
    $this->getJson('/api/v1/brands/kw')->assertOk()->assertJsonPath('data.builds', 1);
    $this->getJson('/api/v1/brands')->assertOk()->assertJsonPath('data.0', ['slug' => 'kw', 'name' => 'KW', 'builds' => 1]);
    $this->getJson('/api/v1/brands/kw/products')->assertOk()->assertJsonPath('data.0.id', $this->v3->id)->assertJsonPath('data.0.builds', 1);

    // The wall still shows the samples (badged), after the real build.
    $wall = $this->getJson('/api/v1/brands/kw/builds')->assertOk()->assertJsonCount(4, 'data');
    expect($wall->json('data.0.id'))->toBe($real->vehicle_id)
        ->and(array_column($wall->json('data'), 'is_sample'))->toBe([false, true, true, true]);

    bizFlags(['editorial_samples' => false]);
    $this->getJson("/api/v1/products/{$this->v3->id}")->assertJsonPath('data.builds', 1);
    $this->getJson('/api/v1/brands/kw/builds')->assertJsonCount(1, 'data');
});

it('keeps a brand carried only by samples in "Marken im Fokus" with 0 builds, below a brand with a real build', function () {
    $other = Brand::factory()->create(['name' => 'Bilstein', 'slug' => 'bilstein']);
    $b14 = Product::factory()->create(['brand_id' => $other->id, 'category_id' => $this->category->id, 'name' => 'B14', 'slug' => 'b14']);
    photoSampleBuild($this->v3);
    photoSampleBuild($this->v1);
    bizBuildWithMod(null, $b14);

    $this->getJson('/api/v1/brands')->assertOk()
        ->assertJsonPath('data', [['slug' => 'bilstein', 'name' => 'Bilstein', 'builds' => 1], ['slug' => 'kw', 'name' => 'KW', 'builds' => 0]]);

    $focus = app(CatalogHighlights::class)->brandsInFocus(null);
    expect(array_column($focus, 'vehicle_count', 'slug'))->toBe(['bilstein' => 1, 'kw' => 0]);
});

it('lists the Teile scope by real build count with thumbnails from real builds only, and the lead and rail on the first page', function () {
    $real = bizBuildWithMod(null, $this->v3);
    bizBuildWithMod(null, $this->v3);
    $v1Real = bizBuildWithMod(null, $this->v1);
    $sample = photoSampleBuild($this->aa);

    $page = $this->getJson('/api/v1/products?counts=1&per_page=2')->assertOk()
        ->assertJsonPath('data.0.id', $this->v3->id)->assertJsonPath('data.0.builds', 2)
        ->assertJsonPath('data.1.id', $this->v1->id)->assertJsonPath('data.1.thumbnail.id', photoCoverId($v1Real))
        ->assertJsonPath('lead_photo.product.id', $this->v3->id)->assertJsonPath('lead_photo.vehicle.is_sample', false)
        ->assertJsonPath('lead_photo.product.brand', ['slug' => 'kw', 'name' => 'KW']);
    expect($page->json('data.0.thumbnail.id'))->not->toBeNull()
        ->and(array_column(array_column($page->json('build_photos'), 'product'), 'id'))->toBe([$this->v3->id, $this->v1->id]);

    // The next page: the sample-only product, no thumbnail (samples never give one), no lead or rail.
    $next = $this->getJson('/api/v1/products?counts=1&per_page=2&cursor='.$page->json('meta.next_cursor'))->assertOk()
        ->assertJsonPath('data.0.id', $this->aa->id)->assertJsonPath('data.0.builds', 0)->assertJsonPath('data.0.thumbnail', null)
        ->assertJsonPath('lead_photo', null)->assertJsonPath('build_photos', []);
    expect($next->json('data'))->toHaveCount(1);

    // The rail of all three: real builds first, then the badged sample.
    $rail = $this->getJson('/api/v1/products?counts=1')->json('build_photos');
    expect(array_column(array_column($rail, 'vehicle'), 'is_sample'))->toBe([false, false, true])
        ->and($rail[2]['vehicle']['id'])->toBe($sample->vehicle_id)
        ->and($rail[0]['vehicle']['path'])->toStartWith('/v/');

    // The autocomplete stays by name, without counts or photos.
    $this->getJson('/api/v1/products?q=Variante')->assertOk()->assertJsonPath('data.0.id', $this->v1->id)->assertJsonPath('data.0.thumbnail', null)
        ->assertJsonPath('lead_photo', null)->assertJsonPath('build_photos', []);
    expect($real)->toBeInstanceOf(Modification::class);
});

it('takes photos only from builds and photos the reader may see', function () {
    $private = bizBuildWithMod(null, $this->v3);
    Vehicle::query()->whereKey($private->vehicle_id)->update(['visibility' => Visibility::Private->value]);
    bizRebuild($private->vehicle);
    $rejected = bizBuildWithMod(null, $this->v1);
    Media::query()->where('mediable_id', $rejected->vehicle_id)->update(['moderation_status' => ModerationStatus::Rejected->value]);
    $blockedOwner = User::factory()->create();
    bizBuildWithMod($blockedOwner, $this->aa);

    $this->getJson('/api/v1/products?counts=1')->assertOk()
        ->assertJsonPath('data.0.id', $this->aa->id)->assertJsonPath('data.0.thumbnail.id', fn ($id) => is_string($id))
        ->assertJsonPath('data.1.thumbnail', null)->assertJsonPath('data.2.thumbnail', null)
        ->assertJsonPath('lead_photo.product.id', $this->aa->id)->assertJsonCount(1, 'build_photos');

    $viewer = User::factory()->create();
    socBlock($viewer, $blockedOwner);
    Sanctum::actingAs($viewer);
    $this->getJson('/api/v1/products?counts=1')->assertOk()->assertJsonPath('data.0.thumbnail', null)
        ->assertJsonPath('lead_photo', null)->assertJsonPath('build_photos', []);
});

it('gives BRD-01 a lead photo from the most-used product and a rail with real builds first; samples go when hidden', function () {
    $sample = photoSampleBuild($this->v1);
    $lead = bizBuildWithMod(null, $this->v3);
    bizBuildWithMod(null, $this->v3);
    $v1Real = bizBuildWithMod(null, $this->v1);

    $response = $this->getJson('/api/v1/brands/kw')->assertOk()
        ->assertJsonPath('data.lead_photo.product.id', $this->v3->id)->assertJsonPath('data.lead_photo.vehicle.is_sample', false)
        ->assertJsonCount(4, 'data.build_photos');
    $rail = $response->json('data.build_photos');
    expect(array_column(array_column($rail, 'vehicle'), 'is_sample'))->toBe([false, false, false, true])
        ->and($rail[3]['vehicle']['id'])->toBe($sample->vehicle_id)
        ->and(in_array($lead->vehicle_id, array_column(array_column($rail, 'vehicle'), 'id'), true))->toBeTrue()
        ->and(collect($rail)->firstWhere('vehicle.id', $v1Real->vehicle_id)['product']['id'] ?? null)->toBe($this->v1->id);

    bizFlags(['editorial_samples' => false]);
    $this->getJson('/api/v1/brands/kw')->assertOk()->assertJsonCount(3, 'data.build_photos');
});

it('falls back to a badged sample for the lead photo only while samples are shown', function () {
    photoSampleBuild($this->v3);

    $this->getJson('/api/v1/brands/kw')->assertOk()->assertJsonPath('data.lead_photo.vehicle.is_sample', true)->assertJsonPath('data.builds', 0);
    bizFlags(['editorial_samples' => false]);
    $this->getJson('/api/v1/brands/kw')->assertOk()->assertJsonPath('data.lead_photo', null)->assertJsonPath('data.build_photos', []);
});

it('lists "Builds mit {Produkt}" with real builds before samples', function () {
    $sample = photoSampleBuild($this->v3);
    $real = bizBuildWithMod(null, $this->v3);
    // The sample changed last: it still comes after the real build.
    Vehicle::query()->whereKey($sample->vehicle_id)->update(['updated_at' => now()->addHour()]);
    bizRebuild($sample->vehicle);

    $this->getJson("/api/v1/products/{$this->v3->id}/builds")->assertOk()
        ->assertJsonPath('data.0.id', $real->vehicle_id)->assertJsonPath('data.1.id', $sample->vehicle_id);
    $first = $this->getJson("/api/v1/products/{$this->v3->id}/builds?per_page=1")->assertJsonPath('data.0.id', $real->vehicle_id);
    $this->getJson("/api/v1/products/{$this->v3->id}/builds?per_page=1&cursor=".$first->json('meta.next_cursor'))
        ->assertJsonPath('data.0.id', $sample->vehicle_id);
});

it('shows the official link, and the affiliate link as "Anzeige" only while affiliate_links is on', function () {
    $this->v3->forceFill(['url' => 'https://www.kw.example/v3', 'affiliate_url' => 'https://partner.example/v3'])->save();

    $this->getJson("/api/v1/products/{$this->v3->id}")->assertOk()->assertJsonPath('data.url', 'https://www.kw.example/v3')->assertJsonPath('data.affiliate', null);
    bizFlags(['affiliate_links' => true]);
    $this->getJson("/api/v1/products/{$this->v3->id}", ['Accept-Language' => 'de'])->assertOk()
        ->assertJsonPath('data.affiliate', ['url' => 'https://partner.example/v3', 'label' => 'Anzeige', 'rel' => 'sponsored noopener']);
});

it('ships official links for catalogue products in the data file', function () {
    $data = json_decode((string) file_get_contents(database_path('data/products.json')), true);
    $urls = array_filter(array_column($data['products'], 'url'));

    expect(count($urls))->toBeGreaterThanOrEqual(2);
    foreach ($urls as $url) {
        expect($url)->toStartWith('https://');
    }
});
