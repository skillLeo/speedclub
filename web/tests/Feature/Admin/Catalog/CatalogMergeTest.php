<?php

use App\Actions\Admin\Catalog\MergeCatalogEntries;
use App\Enums\ApprovalStatus;
use App\Enums\CatalogLevel;
use App\Jobs\Catalog\RelinkCatalogVehicles;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/CatalogHelpers.php';

/**
 * M3.3 merges (m3.3 §1): the survivor takes every reference, the merged slug stays an alias (Discover answers the survivor, a 301 on the
 * old URL), the search projection is rebuilt, `catalog.merged` carries the counts, and more than 100 affected vehicles need four eyes.
 */
beforeEach(function () {
    seedModSchema();
    $this->staff = m33cEditor();
    $this->merge = fn (CatalogLevel $level, int $source, int $target) => app(MergeCatalogEntries::class)->handle($this->staff, $level, $source, $target, m33cReason());
});

function m33cMake(string $slug): Make
{
    return Make::query()->where('slug', $slug)->firstOrFail();
}

it('merges a make: vehicles, models, slugs, search rows and facets follow the survivor', function () {
    $dup = m23Build('Toyta', 'Supra', 'A80', mods: [['wheels_tires', ['diameter' => 19], 'BBS']]);
    $dupOnly = m23Build('Toyta', 'Celica');
    $real = m23Build('Toyota', 'Supra', 'A90');
    $source = m33cMake('toyta');
    $target = m33cMake('toyota');

    $outcome = ($this->merge)(CatalogLevel::Make, $source->id, $target->id);

    expect($outcome->waitsForApproval())->toBeFalse()->and($outcome->summary)->toMatchArray(['vehicles' => 3, 'records' => 2, 'models_moved' => 1, 'models_merged' => 1]);
    $supra = VehicleModel::query()->where('make_id', $target->id)->where('slug', 'supra')->firstOrFail();

    expect($source->refresh()->merged_into_id)->toBe($target->id)->and($source->active)->toBeFalse();
    expect($dup->refresh()->make_id)->toBe($target->id)->and($dup->model_id)->toBe($supra->id)->and($dup->slug)->toStartWith('toyota-supra-a80-');
    expect($dupOnly->refresh()->make_id)->toBe($target->id)->and(VehicleModel::query()->findOrFail($dupOnly->model_id)->make_id)->toBe($target->id);
    expect(Generation::query()->where('model_id', $supra->id)->pluck('slug')->sort()->values()->all())->toBe(['a80', 'a90']);
    expect(DB::table('vehicle_search')->where('make_id', $target->id)->count())->toBe(3);
    expect(DB::table('vehicle_search_facets')->where('vehicle_id', $dup->id)->where('facet', 'wheel_diameter')->value('value'))->toBe('19');

    $event = m33cEvents('catalog.merged')[0];
    expect($event->target_id)->toBe((string) $target->id)
        ->and($event->before['source'])->toMatchArray(['slug' => 'toyta', 'vehicles' => 2])
        ->and($event->before['target'])->toMatchArray(['slug' => 'toyota', 'vehicles' => 1])
        ->and($event->after)->toMatchArray(['vehicles' => 3, 'records' => 2, 'approved_by' => null, 'requested_by' => $this->staff->id]);
    expect($real->refresh()->make_id)->toBe($target->id);
});

it('answers the survivor for the old slug: Discover 301, search filters and query understanding', function () {
    $dup = m23Build('Toyta', 'Supra', 'A80');
    m23Build('Toyota', 'Supra', 'A90');
    ($this->merge)(CatalogLevel::Make, m33cMake('toyta')->id, m33cMake('toyota')->id);

    $this->getJson('/api/v1/discover/makes/toyta')->assertStatus(301)->assertHeader('Location', route('api.v1.discover.makes.show', ['make' => 'toyota']));
    $this->getJson('/api/v1/discover/models/toyta--supra')->assertStatus(301)->assertHeader('Location', route('api.v1.discover.models.show', ['model' => 'toyota--supra']));
    $this->followingRedirects()->getJson('/api/v1/discover/makes/toyta')->assertOk()->assertJsonPath('data.make.slug', 'toyota')->assertJsonPath('data.make.vehicle_count', 2);

    expect(m23Search('make=toyta'))->toHaveCount(2)->toContain($dup->id);
    $this->getJson('/api/v1/search/vehicles?model=toyta--supra&generation=a80')->assertOk()->assertJsonCount(1, 'data');
    $this->getJson('/api/v1/search/interpret?q=toyta')->assertOk()->assertJsonPath('data.filters.make', 'toyota');

    // The old vehicle URL answers 301 to the new slug, through the public id.
    $old = 'toyta-supra-a80-'.strtolower($dup->public_id);
    $this->get('/v/'.$old)->assertStatus(301)->assertRedirectContains($dup->refresh()->slug);
});

it('merges a model across makes and a generation, flattening earlier merges', function () {
    $a = m23Build('BMW', 'M4 Coupe', 'F82');
    $b = m23Build('BMW', 'M4', 'F82');
    $make = m33cMake('bmw');
    $coupe = VehicleModel::query()->where('make_id', $make->id)->where('slug', 'm4-coupe')->firstOrFail();
    $m4 = VehicleModel::query()->where('make_id', $make->id)->where('slug', 'm4')->firstOrFail();

    ($this->merge)(CatalogLevel::Model, $coupe->id, $m4->id);

    $f82 = Generation::query()->where('model_id', $m4->id)->where('slug', 'f82')->firstOrFail();
    expect($a->refresh()->model_id)->toBe($m4->id)->and($a->generation_id)->toBe($f82->id)->and($b->refresh()->generation_id)->toBe($f82->id);
    expect(Generation::query()->where('model_id', $coupe->id)->first()?->merged_into_id)->toBe($f82->id);

    $c = m23Build('BMW', 'M4', 'G82');
    $g82 = Generation::query()->where('slug', 'g82')->firstOrFail();
    ($this->merge)(CatalogLevel::Generation, $f82->id, $g82->id);

    expect($a->refresh()->generation_id)->toBe($g82->id)->and($c->refresh()->generation_id)->toBe($g82->id);
    // The coupe's old F82 row pointed at F82, which pointed at G82: one hop to the survivor now.
    expect(Generation::query()->where('model_id', $coupe->id)->first()?->merged_into_id)->toBe($g82->id);
    $this->getJson('/api/v1/discover/models/bmw--m4/builds?generation=f82')->assertOk()->assertJsonCount(3, 'data');
});

it('merges a brand: modifications, facets, aliases and the search filter of the old slug', function () {
    $vehicle = m23Build('Porsche', '911', '992', mods: [['exhaust', ['type' => 'catback'], 'Akrapovic']]);
    $old = Brand::query()->where('slug', 'akrapovic')->firstOrFail();
    $survivor = Brand::query()->create(['name' => 'Akrapovič', 'slug' => 'akrapovic-sl', 'aliases' => ['Akra']]);

    ($this->merge)(CatalogLevel::Brand, $old->id, $survivor->id);

    expect(Modification::query()->where('vehicle_id', $vehicle->id)->value('brand_id'))->toBe($survivor->id);
    expect($survivor->refresh()->aliases)->toContain('Akra')->toContain('Akrapovic');
    expect($old->refresh()->merged_into_id)->toBe($survivor->id);
    expect(DB::table('vehicle_search_facets')->where('vehicle_id', $vehicle->id)->where('facet', 'exhaust_brand')->value('value'))->toBe((string) $survivor->id);
    expect(m23Search('exhaust_brand[]=akrapovic'))->toBe([$vehicle->id]);
    $this->getJson('/api/v1/catalog/brands?category=exhaust')->assertOk()->assertJsonMissing(['slug' => 'akrapovic']);
});

it('refuses pairs that cannot merge', function (string $case) {
    $a = Make::factory()->create();
    $b = Make::factory()->create();
    $c = Make::factory()->create();
    [$source, $target, $code] = match ($case) {
        'same' => [$a->id, $a->id, 'same_entry'],
        'merged source' => [tap($a)->forceFill(['merged_into_id' => $c->id])->save() ? $a->id : 0, $b->id, 'merged'],
        'merged target' => [$a->id, tap($b)->forceFill(['merged_into_id' => $c->id])->save() ? $b->id : 0, 'merged'],
        'missing' => [$a->id, 999999, 'not_found'],
    };

    expect(fn () => ($this->merge)(CatalogLevel::Make, $source, $target))->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe($code));
})->with(['same', 'merged source', 'merged target', 'missing']);

it('lets only the roles with catalog.manage merge', function (string $role, bool $allowed) {
    $a = Make::factory()->create();
    $b = Make::factory()->create();
    $run = fn () => app(MergeCatalogEntries::class)->handle(m31Staff($role), CatalogLevel::Make, $a->id, $b->id, m33cReason());

    $allowed ? expect($run()->summary)->not->toBeNull() : expect($run)->toThrow(AuthorizationException::class);
})->with(m33cMatrix());

it('asks for four eyes above 100 affected vehicles and runs the merge on approval', function () {
    $owner = User::factory()->create();
    $source = Make::factory()->create(['name' => 'Merc', 'slug' => 'merc']);
    $target = Make::factory()->create(['name' => 'Mercedes-Benz', 'slug' => 'mercedes-benz']);
    $model = VehicleModel::factory()->create(['make_id' => $source->id, 'slug' => 'c63']);
    Vehicle::factory()->count(101)->create(['owner_id' => $owner->id, 'make_id' => $source->id, 'model_id' => $model->id, 'generation_id' => null]);

    $outcome = ($this->merge)(CatalogLevel::Make, $source->id, $target->id);

    expect($outcome->waitsForApproval())->toBeTrue()->and($outcome->approval->action)->toBe('catalog.bulk_merge');
    expect($source->refresh()->merged_into_id)->toBeNull()->and(m33cEvents('catalog.merged'))->toBeEmpty();
    expect($outcome->approval->summary['lines'][2])->toBe(['label' => 'approvals.catalog_bulk_merge.vehicles', 'after' => '101']);

    $done = m33cApprove($outcome->approval);

    expect($done->status)->toBe(ApprovalStatus::Executed)->and($source->refresh()->merged_into_id)->toBe($target->id);
    expect(Vehicle::query()->where('make_id', $target->id)->count())->toBe(101);
    expect(m33cEvents('catalog.merged')[0]->after)->toMatchArray(['records' => 101, 'requested_by' => $this->staff->id]);
    expect(m33cEvents('catalog.merged')[0]->after['approved_by'])->not->toBeNull();
});

it('counts the merges of the last 24 hours towards the threshold', function () {
    Audit::record('catalog.merged', null, after: ['records' => 100, 'approved_by' => null], actor: $this->staff);
    $vehicle = m23Build('Datsun', '240Z');
    $other = Make::factory()->create(['name' => 'Nissan', 'slug' => 'nissan']);

    $outcome = ($this->merge)(CatalogLevel::Make, $vehicle->make_id, $other->id);

    expect($outcome->waitsForApproval())->toBeTrue();
});

it('runs the approved merge only inside its approval', function () {
    $a = Make::factory()->create();
    $b = Make::factory()->create();

    expect(fn () => app(MergeCatalogEntries::class)->execute($this->staff, m31Staff('owner'), CatalogLevel::Make, $a->id, $b->id, m33cReason()))
        ->toThrow(AuthorizationException::class);
    expect($a->refresh()->merged_into_id)->toBeNull();
});

it('fails the approval when the pair was merged in the meantime', function () {
    Audit::record('catalog.merged', null, after: ['records' => 100, 'approved_by' => null], actor: $this->staff);
    $vehicle = m23Build('Datsun', '240Z');
    $target = Make::factory()->create();
    $outcome = ($this->merge)(CatalogLevel::Make, $vehicle->make_id, $target->id);
    Make::query()->whereKey($vehicle->make_id)->update(['merged_into_id' => Make::factory()->create()->id]);

    expect(m33cApprove($outcome->approval)->status)->toBe(ApprovalStatus::Failed);
});

it('relinks again without changes (idempotent job)', function () {
    $vehicle = m23Build('Toyta', 'Supra');
    $target = Make::factory()->create(['name' => 'Toyota', 'slug' => 'toyota']);
    ($this->merge)(CatalogLevel::Make, m33cMake('toyta')->id, $target->id);
    $slug = $vehicle->refresh()->slug;

    RelinkCatalogVehicles::dispatchSync('make:'.m33cMake('toyta')->id);
    RelinkCatalogVehicles::dispatchSync('make:'.$target->id);

    expect($vehicle->refresh()->slug)->toBe($slug)->and($vehicle->make_id)->toBe($target->id);
});
