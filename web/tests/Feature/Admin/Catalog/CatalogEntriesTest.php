<?php

use App\Actions\Admin\Catalog\CreateCatalogEntry;
use App\Actions\Admin\Catalog\DeleteCatalogEntry;
use App\Actions\Admin\Catalog\SetCatalogEntryActive;
use App\Actions\Admin\Catalog\UpdateCatalogEntry;
use App\Enums\CatalogLevel;
use App\Models\DiscoverCollection;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CatalogHelpers.php';

/**
 * M3.3 ADM-14 / ADM-16 entry Actions: create, edit (slug only before the first reference), deactivate, delete only when nothing points
 * at the entry (m3.3 §1).
 */
beforeEach(function () {
    seedModSchema();
    $this->staff = m33cEditor();
});

it('lets only the roles with catalog.manage create an entry', function (string $role, bool $allowed) {
    $staff = m31Staff($role);
    $create = fn () => app(CreateCatalogEntry::class)->handle($staff, CatalogLevel::Make, ['name' => 'Polestar', 'country' => 'se']);

    if (! $allowed) {
        expect($create)->toThrow(AuthorizationException::class);
        expect(Make::query()->where('slug', 'polestar')->exists())->toBeFalse();

        return;
    }

    $make = $create();
    expect($make->slug)->toBe('polestar')->and($make->country)->toBe('SE')->and($make->active)->toBeTrue();
    expect(m33cEvents('catalog.created'))->toHaveCount(1);
})->with(m33cMatrix());

it('refuses a suspended staff member', function () {
    $staff = m31Staff('admin', attributes: ['status' => 'suspended']);

    expect(fn () => app(CreateCatalogEntry::class)->handle($staff, CatalogLevel::Make, ['name' => 'Polestar']))->toThrow(AuthorizationException::class);
});

it('creates models and generations under their parent and refuses a taken slug', function () {
    $make = app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Make, ['name' => 'Toyota']);
    $model = app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Model, ['make_id' => $make->id, 'name' => 'GR Supra']);
    $generation = app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Generation, ['model_id' => $model->id, 'name' => 'A90', 'year_from' => 2019]);

    expect($model->slug)->toBe('gr-supra')->and($generation->slug)->toBe('a90')->and($generation->year_from)->toBe(2019);
    expect(fn () => app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Model, ['make_id' => $make->id, 'name' => 'GR-Supra']))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('slug_taken'));
});

it('validates the input', function (array $input, string $field) {
    expect(fn () => app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Make, $input))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey($field));
})->with([
    'no name' => [['country' => 'DE'], 'name'],
    'long name' => [['name' => str_repeat('x', 101)], 'name'],
    'country' => [['name' => 'Opel', 'country' => 'DEU'], 'country'],
    'slug with double dash' => [['name' => 'Opel', 'slug' => 'op--el'], 'slug'],
]);

it('edits name and country and relinks the slugs of existing builds', function () {
    $vehicle = m23Build('Toyta', 'Supra', 'A80');
    $make = Make::query()->where('slug', 'toyta')->firstOrFail();

    app(UpdateCatalogEntry::class)->handle($this->staff, $make, ['name' => 'Toyota', 'country' => 'JP']);

    expect($make->refresh()->name)->toBe('Toyota')->and($make->slug)->toBe('toyta');
    expect($vehicle->refresh()->slug)->toStartWith('toyota-supra-a80-');
    expect(DB::table('vehicle_search')->where('vehicle_id', $vehicle->id)->value('title_keys'))->toContain('toyota');
    $event = m33cEvents('catalog.updated')[0];
    expect($event->before)->toMatchArray(['name' => 'Toyta', 'country' => 'DE'])->and($event->after)->toMatchArray(['name' => 'Toyota', 'country' => 'JP']);
});

it('changes a slug only before the first reference', function () {
    $free = Make::factory()->create(['name' => 'Lynk', 'slug' => 'lynk']);
    app(UpdateCatalogEntry::class)->handle($this->staff, $free, ['slug' => 'lynk-co']);
    expect($free->refresh()->slug)->toBe('lynk-co');

    m23Build('Mazda', 'MX-5', 'ND');
    $used = Make::query()->where('slug', 'mazda')->firstOrFail();

    expect(fn () => app(UpdateCatalogEntry::class)->handle($this->staff, $used, ['slug' => 'mazda-jp']))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('slug_locked'));
    expect($used->refresh()->slug)->toBe('mazda');
});

it('locks the slug of a make a Kollektion names', function () {
    $make = Make::factory()->create(['name' => 'Alpina', 'slug' => 'alpina']);
    DiscoverCollection::factory()->create(['filters' => ['make' => 'alpina']]);

    expect(fn () => app(UpdateCatalogEntry::class)->handle($this->staff, $make, ['slug' => 'alpina-bmw']))->toThrow(CatalogRefused::class);
});

it('deactivates with a reason, hides from the pickers and keeps existing builds', function () {
    $vehicle = m23Build('Lancia', 'Delta', 'HF Integrale');
    $generation = Generation::query()->where('slug', 'hf-integrale')->firstOrFail();
    $model = VehicleModel::query()->findOrFail($generation->model_id);

    expect(fn () => app(SetCatalogEntryActive::class)->handle($this->staff, $generation, false, 'kurz'))->toThrow(ValidationException::class);

    app(SetCatalogEntryActive::class)->handle($this->staff, $generation, false, m33cReason());

    $this->getJson("/api/v1/catalog/models/{$model->id}/generations")->assertOk()->assertJsonCount(0, 'data');
    expect($vehicle->refresh()->generation_id)->toBe($generation->id);
    expect(m33cEvents('catalog.deactivated'))->toHaveCount(1);

    app(SetCatalogEntryActive::class)->handle($this->staff, $generation, true, m33cReason());
    $this->getJson("/api/v1/catalog/models/{$model->id}/generations")->assertOk()->assertJsonCount(1, 'data');
});

it('refuses an inactive generation for a vehicle', function () {
    $generation = Generation::factory()->create(['active' => false]);
    $owner = User::factory()->create();
    $vehicle = Vehicle::factory()->create(['owner_id' => $owner->id]);

    Sanctum::actingAs($owner);
    $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['generation_id' => $generation->id])
        ->assertUnprocessable()->assertJsonValidationErrors('generation_id');
});

it('refuses to delete what a vehicle points at, deleted vehicles included', function () {
    $vehicle = m23Build('Saab', '900', 'Turbo');
    $make = Make::query()->where('slug', 'saab')->firstOrFail();
    $vehicle->delete();

    expect(fn () => app(DeleteCatalogEntry::class)->handle($this->staff, $make, m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('referenced')->and($e->count)->toBe(1)->and($e->context['vehicles'])->toBe(1));
    expect(Make::query()->whereKey($make->id)->exists())->toBeTrue();
});

it('deletes an unreferenced make with its models and generations', function () {
    $generation = Generation::factory()->create();
    $model = VehicleModel::query()->findOrFail($generation->model_id);
    $make = Make::query()->findOrFail($model->make_id);

    $removed = app(DeleteCatalogEntry::class)->handle($this->staff, $make, m33cReason());

    expect($removed)->toBe(['models' => 1, 'generations' => 1]);
    expect(Make::query()->whereKey($make->id)->exists())->toBeFalse()->and(Generation::query()->whereKey($generation->id)->exists())->toBeFalse();
    expect(m33cEvents('catalog.deleted')[0]->before)->toMatchArray(['level' => 'make', 'slug' => $make->slug]);
});
