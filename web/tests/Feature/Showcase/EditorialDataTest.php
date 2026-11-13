<?php

use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\VehicleModel;
use App\Services\Garage\ModFields;
use App\Services\Showcase\ShowcasePhotos;
use App\Support\Username;
use Database\Seeders\BrandSeeder;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\ModCategorySeeder;

/**
 * M4.2, 09 §8.19: database/data/showcase/editorial.json against the real catalogue, brands, mod schema and seed photo manifest, so
 * every one of its 30–40 builds can be seeded (the seeder test only has photos for a few of them): the catalogue knows the make, model
 * and generation, the named shoot shows exactly that car, no shoot is used twice, every part is of a brand of the brands table and its
 * fields pass the category's schema, and every build names the source of its figures.
 */
function editorialData(): array
{
    return json_decode((string) file_get_contents(database_path('data/showcase/editorial.json')), true, flags: JSON_THROW_ON_ERROR);
}

it('describes one valid Editorial account and 30 to 40 builds across the makes 09 §15 names', function () {
    $data = editorialData();
    $makes = array_unique(array_column($data['vehicles'], 'make'));

    expect(Username::violations($data['member']['username']))->toBe([])
        ->and($data['member']['display_name'])->toBe('SPEED CLUB Editorial')
        ->and(count($data['vehicles']))->toBeGreaterThanOrEqual(30)->toBeLessThanOrEqual(40)
        ->and(array_values(array_diff(['BMW', 'Porsche', 'Volkswagen', 'Audi', 'Mercedes-Benz', 'Toyota', 'Nissan', 'Honda', 'Mazda', 'Subaru'], $makes)))->toBe([])
        ->and(array_unique(array_column($data['vehicles'], 'key')))->toHaveCount(count($data['vehicles']))
        ->and(array_unique(array_column($data['vehicles'], 'car')))->toHaveCount(count($data['vehicles']));
});

it('names for every build a shoot of exactly its make, model and generation', function () {
    $manifest = json_decode((string) file_get_contents(base_path('../design/seed-photos/manifest.json')), true, flags: JSON_THROW_ON_ERROR);
    $shoots = collect($manifest)->groupBy('car');

    foreach (editorialData()['vehicles'] as $vehicle) {
        $photos = $shoots->get($vehicle['car']);

        expect($photos)->not->toBeNull("{$vehicle['key']}: shoot {$vehicle['car']} is not in the manifest");

        foreach ($photos ?? [] as $photo) {
            expect(ShowcasePhotos::matches($photo['make'], $photo['model'], (string) $photo['generation'], $vehicle['make'], $vehicle['model'], $vehicle['generation']))
                ->toBeTrue("{$vehicle['key']}: {$photo['file']} shows a {$photo['make']} {$photo['model']} {$photo['generation']}");
        }
    }
});

it('fits the catalogue, the brands and the mod schema, with manufacturer figures and their source', function () {
    $this->seed([CatalogSeeder::class, BrandSeeder::class, ModCategorySeeder::class]);
    $brands = Brand::query()->pluck('id', 'name');
    $categories = ModCategory::query()->with('fields')->get()->keyBy('key');
    $fields = app(ModFields::class);

    foreach (editorialData()['vehicles'] as $vehicle) {
        $make = Make::query()->where('name', $vehicle['make'])->first();
        $model = VehicleModel::query()->where('make_id', $make?->id)->where('name', $vehicle['model'])->first();
        $generation = Generation::query()->where('model_id', $model?->id)->where('name', $vehicle['generation'])->first();

        expect($generation)->not->toBeNull("{$vehicle['key']}: {$vehicle['make']} {$vehicle['model']} {$vehicle['generation']} is not in the catalogue")
            ->and($vehicle['source'] ?? '')->not->toBe('')
            ->and($vehicle['specs']['power_kw'])->toBeInt()->toBeGreaterThan(50)->toBeLessThan(600)
            ->and($vehicle['specs']['torque_nm'])->toBeInt()->toBeGreaterThan(100)->toBeLessThan(1000)
            ->and(count($vehicle['mods']))->toBeGreaterThanOrEqual(5)
            ->and($vehicle['description'])->toStartWith('Beispiel-Build der Redaktion');

        foreach ($vehicle['mods'] as $mod) {
            $category = $categories->get($mod['c']);

            expect($brands->has($mod['b']))->toBeTrue("{$vehicle['key']}: brand {$mod['b']} is not in the brands table")
                ->and($category)->not->toBeNull()
                ->and($mod['lg'])->toBe('unknown')
                ->and($fields->validated($category, $mod['c'] === 'other' ? ['title' => $mod['b'].' '.$mod['p']] : $mod['f']))->toBeArray();
        }
    }
});
