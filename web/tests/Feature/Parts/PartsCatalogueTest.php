<?php

use App\Enums\ProductStatus;
use App\Enums\Visibility;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Parts\ProductCatalogue;
use Database\Seeders\BrandSeeder;
use Database\Seeders\ModCategorySeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Businesses/BusinessTestHelpers.php';

/**
 * M4.14 parts catalogue (09 §8.9, §7.11 BRD-01/02): the flag, product search and autocomplete, BRD-02 with the affiliate rule, real
 * "In N Builds" counts that follow the visibility rules, brand pages, the mod ↔ product link and the import of the data file.
 */
beforeEach(function () {
    bizFlags();
    $this->brand = Brand::factory()->create(['name' => 'KW', 'slug' => 'kw', 'about' => ['de' => 'Fahrwerkshersteller aus Fichtenberg.', 'en' => 'Suspension maker from Fichtenberg.'], 'website' => 'https://example.test']);
    $this->category = ModCategory::factory()->create(['key' => 'suspension_test']);
    $this->v3 = Product::factory()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'Variante 3', 'slug' => 'variante-3', 'line' => 'Gewindefahrwerke',
        'attributes' => ['de' => [['Bauart', 'Gewindefahrwerk']], 'en' => [['Type', 'Coilover kit']]], 'affiliate_url' => 'https://partner.example.test/kw-v3']);
    $this->v1 = Product::factory()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'Variante 1', 'slug' => 'variante-1', 'line' => 'Gewindefahrwerke']);
});

it('answers 404 feature_disabled on every route while parts_catalogue is off', function (string $uri) {
    bizFlags(['parts_catalogue' => false]);
    $uri = str_replace('{product}', $this->v3->id, $uri);

    $this->getJson($uri)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
})->with(['/api/v1/brands', '/api/v1/brands/kw', '/api/v1/brands/kw/products', '/api/v1/brands/kw/builds', '/api/v1/products', '/api/v1/products/{product}', '/api/v1/products/{product}/builds']);

it('searches active products for guests and members, by name, brand and category', function (?string $as) {
    if ($as === 'member') {
        Sanctum::actingAs(User::factory()->create());
    }

    Product::factory()->archived()->create(['brand_id' => $this->brand->id, 'category_id' => $this->category->id, 'name' => 'Variante 2']);

    $this->getJson('/api/v1/products?q=Variante')->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.full_name', 'KW Variante 1')->assertJsonPath('data.0.builds', null);
    $this->getJson('/api/v1/products?q=kw&brand=kw&category=suspension_test&counts=1')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.1.builds', 0);
    $this->getJson('/api/v1/products?brand=unknown')->assertOk()->assertJsonCount(0, 'data');
})->with(['guest' => [null], 'member' => ['member']]);

it('validates the search', function (array $query) {
    $this->getJson('/api/v1/products?'.http_build_query($query))->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
})->with([
    'q too short' => [['q' => 'k']],
    'unknown category' => [['category' => 'nope']],
    'page too large' => [['per_page' => 500]],
]);

it('shows BRD-02 with attributes in the reader language and the affiliate link only while affiliate_links is on', function () {
    $this->getJson("/api/v1/products/{$this->v3->id}", ['Accept-Language' => 'en'])->assertOk()
        ->assertJsonPath('data.attributes.0', ['label' => 'Type', 'value' => 'Coilover kit'])
        ->assertJsonPath('data.affiliate', null)
        ->assertJsonPath('data.brand_path', '/brands/kw');

    bizFlags(['affiliate_links' => true]);
    $this->getJson("/api/v1/products/{$this->v3->id}", ['Accept-Language' => 'de'])->assertOk()
        ->assertJsonPath('data.attributes.0', ['label' => 'Bauart', 'value' => 'Gewindefahrwerk'])
        ->assertJsonPath('data.affiliate.label', 'Anzeige')->assertJsonPath('data.affiliate.rel', 'sponsored noopener');
});

it('answers a merged product as its survivor and an unknown one with product_unavailable', function () {
    $this->v1->forceFill(['merged_into_id' => $this->v3->id, 'status' => ProductStatus::Archived])->save();

    $this->getJson("/api/v1/products/{$this->v1->id}")->assertOk()->assertJsonPath('data.id', $this->v3->id);
    $this->getJson('/api/v1/products/01jzzzzzzzzzzzzzzzzzzzzzzz')->assertNotFound()->assertJsonPath('code', 'product_unavailable');
});

it('counts and lists only builds the reader may see ("Builds mit {Produkt}")', function () {
    $visible = bizBuildWithMod(null, $this->v3);
    $private = bizBuildWithMod(null, $this->v3);
    Vehicle::query()->whereKey($private->vehicle_id)->update(['visibility' => Visibility::Private->value]);
    bizRebuild($private->vehicle);
    $blockedOwner = User::factory()->create();
    bizBuildWithMod($blockedOwner, $this->v3);
    $deleted = bizBuildWithMod(null, $this->v3);
    $deleted->delete();

    $this->getJson("/api/v1/products/{$this->v3->id}")->assertJsonPath('data.builds', 2);
    $this->getJson("/api/v1/products/{$this->v3->id}/builds")->assertOk()->assertJsonCount(2, 'data');

    $viewer = User::factory()->create();
    socBlock($viewer, $blockedOwner);
    Sanctum::actingAs($viewer);
    $this->getJson("/api/v1/products/{$this->v3->id}")->assertJsonPath('data.builds', 1);
    $this->getJson("/api/v1/products/{$this->v3->id}/builds")->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $visible->vehicle_id);
});

it('hides sample builds from counts while editorial_samples is off', function () {
    $mod = bizBuildWithMod(User::factory()->create(['is_sample' => true]), $this->v3);
    Vehicle::query()->whereKey($mod->vehicle_id)->update(['is_sample' => true]);
    bizRebuild($mod->vehicle);

    $this->getJson("/api/v1/products/{$this->v3->id}")->assertJsonPath('data.builds', 1);
    bizFlags(['editorial_samples' => false]);
    $this->getJson("/api/v1/products/{$this->v3->id}")->assertJsonPath('data.builds', 0);
});

it('shows BRD-01 with about, real counts, lines, products and builds', function () {
    bizBuildWithMod(null, $this->v3);

    $this->getJson('/api/v1/brands/kw', ['Accept-Language' => 'de'])->assertOk()
        ->assertJsonPath('data.name', 'KW')->assertJsonPath('data.about', 'Fahrwerkshersteller aus Fichtenberg.')
        ->assertJsonPath('data.builds', 1)->assertJsonPath('data.products', 2)
        ->assertJsonPath('data.lines', [['name' => 'Gewindefahrwerke', 'products' => 2]]);
    $this->getJson('/api/v1/brands/kw/products')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.1.builds', 1);
    $this->getJson('/api/v1/brands/kw/builds')->assertOk()->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/brands')->assertOk()->assertJsonPath('data.0', ['slug' => 'kw', 'name' => 'KW', 'builds' => 1]);
});

it('has no page for a brand without products or builds, and answers a merged brand as its survivor', function () {
    Brand::factory()->create(['name' => 'Leer', 'slug' => 'leer']);
    Brand::factory()->create(['name' => 'K.W.', 'slug' => 'k-w', 'merged_into_id' => $this->brand->id]);

    $this->getJson('/api/v1/brands/leer')->assertNotFound()->assertJsonPath('code', 'not_found');
    $this->getJson('/api/v1/brands/nope')->assertNotFound();
    $this->getJson('/api/v1/brands/k-w')->assertOk()->assertJsonPath('data.slug', 'kw');
});

it('links a product on a mod: brand and part follow, the owner and readers see it, archived products are refused', function () {
    $owner = User::factory()->create();
    $mod = bizBuildWithMod($owner);
    Sanctum::actingAs($owner);

    $this->patchJson("/api/v1/mods/{$mod->id}", ['product_id' => $this->v3->id])->assertOk()
        ->assertJsonPath('data.product.full_name', 'KW Variante 3')->assertJsonPath('data.product.brand_slug', 'kw');
    $mod->refresh();
    expect($mod->product_id)->toBe($this->v3->id)->and($mod->brand_id)->toBe($this->brand->id)->and($mod->part_name)->toBe('Variante 3');

    $this->v1->forceFill(['status' => ProductStatus::Archived])->save();
    $this->patchJson("/api/v1/mods/{$mod->id}", ['product_id' => $this->v1->id])->assertUnprocessable()->assertJsonValidationErrors('product_id');

    $this->patchJson("/api/v1/mods/{$mod->id}", ['product_id' => null])->assertOk()->assertJsonPath('data.product', null);
    expect($mod->refresh()->product_id)->toBeNull()->and($mod->part_name)->toBe('Variante 3');
});

it('ignores the product link while parts_catalogue is off', function () {
    bizFlags(['parts_catalogue' => false]);
    $owner = User::factory()->create();
    $mod = bizBuildWithMod($owner);
    Sanctum::actingAs($owner);

    $this->patchJson("/api/v1/mods/{$mod->id}", ['product_id' => $this->v3->id])->assertOk()->assertJsonPath('data.product', null);
    expect($mod->refresh()->product_id)->toBeNull();
});

it('refuses another member linking a product on a mod that is not theirs', function () {
    $mod = bizBuildWithMod();
    Sanctum::actingAs(User::factory()->create());

    $this->patchJson("/api/v1/mods/{$mod->id}", ['product_id' => $this->v3->id])->assertForbidden();
    expect(Modification::query()->find($mod->id)?->product_id)->toBeNull();
});

it('imports the data file: real brands only, idempotent, dry run writes nothing', function () {
    $this->seed([ModCategorySeeder::class, BrandSeeder::class]);
    Product::query()->delete();

    $this->artisan('catalog:import-products', ['--dry-run' => true])->assertSuccessful();
    expect(Product::query()->count())->toBe(0);

    $this->artisan('catalog:import-products')->assertSuccessful();
    $count = Product::query()->count();
    expect($count)->toBeGreaterThan(90)
        ->and(Product::query()->whereHas('brand', fn ($q) => $q->where('slug', 'kw'))->where('slug', 'variante-3')->exists())->toBeTrue()
        ->and(Brand::query()->where('slug', 'bbs')->value('country'))->toBe('DE');

    $again = app(ProductCatalogue::class)->importFile(database_path(ProductCatalogue::DATA_FILE));
    expect($again['created'])->toBe(0)->and($again['unchanged'])->toBe($count)->and($again['errors'])->toBe([]);

    $bad = app(ProductCatalogue::class)->import(['products' => [['brand' => 'Erfundene Marke', 'category' => 'suspension', 'name' => 'X']]]);
    expect($bad['errors'])->toHaveCount(1)->and($bad['created'])->toBe(0);
});
