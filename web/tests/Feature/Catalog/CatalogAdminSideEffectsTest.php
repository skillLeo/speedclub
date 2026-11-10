<?php

use App\Enums\NotificationType;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\User;
use App\Models\VehicleModel;
use App\Services\Catalog\BrandNormaliser;
use App\Services\Catalog\CatalogSlugs;
use App\Services\Notifications\NotificationTexts;

require_once __DIR__.'/../Discover/DiscoverM23Helpers.php';

/**
 * M3.3 member-facing side of the catalogue admin: alias lookups, the pickers, the normaliser and the new notification type.
 */
beforeEach(function () {
    seedModSchema();
});

it('resolves merged slugs to their survivor on every level, one hop or several', function () {
    $survivor = Make::factory()->create(['slug' => 'toyota']);
    $middle = Make::factory()->create(['slug' => 'toyota-jp', 'merged_into_id' => $survivor->id, 'active' => false]);
    Make::factory()->create(['slug' => 'toyta', 'merged_into_id' => $middle->id, 'active' => false]);
    $model = VehicleModel::factory()->create(['make_id' => $survivor->id, 'slug' => 'supra']);
    // A model left under the merged make as an alias.
    VehicleModel::factory()->create(['make_id' => $middle->id, 'slug' => 'supra-mk4', 'merged_into_id' => $model->id, 'active' => false]);
    $generation = Generation::factory()->create(['model_id' => $model->id, 'slug' => 'a80']);
    Generation::factory()->create(['model_id' => $model->id, 'slug' => 'jza80', 'merged_into_id' => $generation->id, 'active' => false]);

    expect(CatalogSlugs::make('toyta')?->id)->toBe($survivor->id)
        ->and(CatalogSlugs::modelKey('toyota-jp--supra-mk4')?->id)->toBe($model->id)
        ->and(CatalogSlugs::modelKey('toyta--supra')?->id)->toBe($model->id)
        ->and(CatalogSlugs::generation($model, 'jza80')?->id)->toBe($generation->id)
        ->and(CatalogSlugs::make('nope'))->toBeNull()
        ->and(CatalogSlugs::modelKey('toyota-supra'))->toBeNull();
});

it('offers no merged or inactive entries in the pickers', function () {
    $make = Make::factory()->create(['slug' => 'aaa-live']);
    Make::factory()->create(['slug' => 'aaa-merged', 'merged_into_id' => $make->id, 'active' => false]);
    $model = VehicleModel::factory()->create(['make_id' => $make->id]);
    Generation::factory()->create(['model_id' => $model->id, 'slug' => 'live']);
    Generation::factory()->create(['model_id' => $model->id, 'slug' => 'off', 'active' => false]);

    $slugs = collect($this->getJson('/api/v1/catalog/makes?per_page=500')->assertOk()->json('data'))->pluck('slug');
    expect($slugs)->toContain('aaa-live')->not->toContain('aaa-merged');
    expect(collect($this->getJson("/api/v1/catalog/models/{$model->id}/generations")->assertOk()->json('data'))->pluck('slug')->all())->toBe(['live']);
});

it('suggests brand merges for names equal after folding, survivor with diacritics', function () {
    Brand::query()->where('slug', 'akrapovic')->update(['name' => 'Akrapovič', 'aliases' => null]);
    $plain = Brand::query()->create(['name' => 'AKRAPOVIC', 'slug' => 'akrapovic-caps']);
    $dash = Brand::query()->create(['name' => 'Akra-povic', 'slug' => 'akra-povic']);
    Brand::query()->create(['name' => 'Akrapovic Old', 'slug' => 'akrapovic-old', 'merged_into_id' => $plain->id]);
    $vehicle = m23Build('BMW', 'M2');
    Modification::factory()->create(['vehicle_id' => $vehicle->id, 'category_id' => modCategory('exhaust')->id, 'brand_id' => $plain->id]);

    $group = collect(app(BrandNormaliser::class)->suggestions())->firstWhere('key', 'akrapovic');

    expect($group['survivor']['name'])->toBe('Akrapovič');
    // Mixed case before all caps; the merged brand is no candidate.
    expect(collect($group['duplicates'])->pluck('id')->all())->toBe([$dash->id, $plain->id])->and($group['duplicates'][1]['usage'])->toBe(1);
    expect(BrandNormaliser::fold('Öhlins Racing'))->toBe('ohlinsracing');
});

it('renders the catalogue request notification in both languages', function () {
    $member = User::factory()->create(['locale' => 'en']);
    $row = new Notification;
    $row->forceFill(['type' => NotificationType::CatalogRequest, 'notifiable_type' => 'user', 'notifiable_id' => $member->id, 'data' => ['outcome' => 'rejected', 'requested' => 'Wiesmann MF5', 'reason' => 'x']]);

    expect(app(NotificationTexts::class)->push($row, $member)['body'] ?? null)->toContain('Wiesmann MF5');
    expect(NotificationType::CatalogRequest->pushPreference())->toBeNull()->and(NotificationType::CatalogRequest->alwaysPushes())->toBeFalse();
    expect(app(NotificationTexts::class)->path($row))->toBe('/notifications');
});
