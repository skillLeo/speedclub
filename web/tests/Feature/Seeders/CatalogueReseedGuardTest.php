<?php

use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Models\VehicleModel;
use Carbon\CarbonImmutable;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Facades\File;

/**
 * ADR-234: the catalogue seeders only fill an empty catalogue on install. Run again on a host whose catalogue has rows (db:seed by
 * mistake, a deploy script), they never bring back an entry, a field or a brand the team deleted in the admin. And the release
 * register path falls back to the RELEASES.md the deploy package ships when docs/ is not next to the app. Demo staff date from the
 * demo clock (ADM-40 "Im Team seit").
 */
beforeEach(fn () => config(['speedclub.staff.owner_email' => 'owner@example.test']));

it('does not bring back a make, a mod field or a brand deleted in the admin when the seeders run again', function () {
    $this->seed(DatabaseSeeder::class);
    // The last ones: the Discover collections (CollectionSeeder) point at the popular makes, which come first.
    $make = Make::query()->orderByDesc('id')->firstOrFail();
    $models = VehicleModel::query()->where('make_id', $make->id)->pluck('id');
    Generation::query()->whereIn('model_id', $models)->delete();
    VehicleModel::query()->whereIn('id', $models)->delete();
    $make->delete();
    $field = ModCategoryField::query()->orderByDesc('id')->firstOrFail();
    $field->delete();
    $brand = Brand::query()->orderByDesc('id')->firstOrFail();
    $brand->delete();
    $counts = fn (): array => [Make::query()->count(), VehicleModel::query()->count(), Generation::query()->count(), ModCategoryField::query()->count(), Brand::query()->count()];
    $before = $counts();

    $this->seed(DatabaseSeeder::class);
    $this->seed(CatalogSeeder::class);

    expect($counts())->toBe($before)
        ->and(Make::query()->whereKey($make->id)->exists())->toBeFalse()
        ->and(Make::query()->where('slug', $make->slug)->exists())->toBeFalse()
        ->and(ModCategoryField::query()->where('category_id', $field->category_id)->where('key', $field->key)->exists())->toBeFalse()
        ->and(Brand::query()->where('slug', $brand->slug)->exists())->toBeFalse();
});

it('leaves a catalogue alone that the team started by hand', function () {
    Make::query()->create(['slug' => 'wiesmann', 'name' => 'Wiesmann', 'country' => 'DE', 'is_popular' => false, 'sort' => 1]);

    $this->seed(CatalogSeeder::class);

    expect(Make::query()->count())->toBe(1)->and(VehicleModel::query()->count())->toBe(0);
});

it('fills an empty catalogue', function () {
    $this->seed(DatabaseSeeder::class);

    expect(Make::query()->count())->toBeGreaterThanOrEqual(40)
        ->and(ModCategory::query()->count())->toBe(10)
        ->and(Brand::query()->count())->toBeGreaterThanOrEqual(150);
});

it('reads RELEASES.md next to the app when the repository docs are not there', function () {
    $real = base_path();
    $config = config_path('speedclub.php');
    $package = sys_get_temp_dir().'/m3q-package-'.bin2hex(random_bytes(4)).'/speedclub';
    File::ensureDirectoryExists($package);

    try {
        expect(config('speedclub.content.releases_path'))->toBe(realpath($real.'/../docs/RELEASES.md') !== false ? $real.'/../docs/RELEASES.md' : $real.'/RELEASES.md');

        app()->setBasePath($package);
        $evaluated = require $config;

        expect($evaluated['content']['releases_path'])->toBe($package.'/RELEASES.md');
    } finally {
        app()->setBasePath($real);
        File::deleteDirectory(dirname($package));
    }
});

it('dates the demo staff accounts to the demo clock, never a real Owner', function (string $environment, bool $demo) {
    app()->detectEnvironment(fn () => $environment);
    config(['speedclub.staff.owner_email' => 'owner@example.test', 'speedclub.demo.staff_password' => 'demo-staff-password']);
    $this->travelTo(CarbonImmutable::parse('2026-11-09 10:00:00'));

    app(StaffSeeder::class)->setContainer(app())->__invoke();
    $owner = Staff::query()->where('email', 'owner@example.test')->firstOrFail();

    expect($owner->created_at?->toDateTimeString())->toBe($demo ? DemoSeeder::NOW : '2026-11-09 10:00:00');

    if ($demo) {
        expect(Staff::query()->where('email', 'like', '%@speedclub.test')->pluck('created_at')->map->toDateTimeString()->unique()->all())->toBe([DemoSeeder::NOW]);

        // A re-seed changes nothing.
        $this->travel(1)->day();
        app(StaffSeeder::class)->setContainer(app())->__invoke();
        expect(Staff::query()->where('email', 'moderator@speedclub.test')->value('created_at')?->toDateTimeString())->toBe(DemoSeeder::NOW);
    }
})->with([
    'local' => ['local', true],
    'staging' => ['staging', true],
    'production' => ['production', false],
]);
