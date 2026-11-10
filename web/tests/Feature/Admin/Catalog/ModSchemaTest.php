<?php

use App\Actions\Admin\Catalog\ArchiveModField;
use App\Actions\Admin\Catalog\CreateModCategory;
use App\Actions\Admin\Catalog\CreateModField;
use App\Actions\Admin\Catalog\DeleteModField;
use App\Actions\Admin\Catalog\ReorderModFields;
use App\Actions\Admin\Catalog\UpdateModCategory;
use App\Actions\Admin\Catalog\UpdateModField;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModCategorySchemaVersion;
use App\Services\Catalog\CatalogRefused;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CatalogHelpers.php';

/**
 * M3.3 ADM-15 (m3.3 §1): versioned field schemas, fields with data archived and never deleted, refused type changes and narrowing with
 * the count of affected modifications, immutable keys.
 */
beforeEach(function () {
    seedModSchema();
    $this->staff = m33cEditor();
    $this->suspension = modCategory('suspension');
    $this->type = ModCategoryField::query()->where('category_id', $this->suspension->id)->where('key', 'type')->firstOrFail();
});

function m33cField(string $category, string $key): ModCategoryField
{
    return ModCategoryField::query()->where('category_id', modCategory($category)->id)->where('key', $key)->firstOrFail();
}

it('writes version 1 and the new version with every field change, and audits the diff', function () {
    app(UpdateModField::class)->handle($this->staff, $this->type, ['label' => ['de' => 'Fahrwerksart', 'en' => 'Suspension type']], m33cReason());

    $versions = ModCategorySchemaVersion::query()->where('category_id', $this->suspension->id)->orderBy('version')->get();
    expect($versions)->toHaveCount(2)->and($versions[0]->staff_id)->toBeNull()->and($versions[1]->staff_id)->toBe($this->staff->id)->and($versions[1]->reason)->toBe(m33cReason());
    expect(collect($versions[1]->schema)->firstWhere('key', 'type')['label']['de'])->toBe('Fahrwerksart');

    $event = m33cEvents('catalog.schema_changed')[0];
    expect($event->before['version'])->toBe(1)->and($event->after['version'])->toBe(2)->and($event->after['change'])->toBe('field_updated');
    expect($event->before['fields'][(string) $this->type->id]['label']['de'])->toBe('Art')
        ->and($event->after['fields'][(string) $this->type->id])->toHaveKeys(['key', 'label'])->not->toHaveKey('options');

    app(CreateModField::class)->handle($this->staff, $this->suspension, ['key' => 'camber_kit', 'label' => ['de' => 'Sturzkit', 'en' => 'Camber kit'], 'type' => 'boolean'], m33cReason());
    expect(ModCategorySchemaVersion::query()->where('category_id', $this->suspension->id)->max('version'))->toBe(3);
});

it('needs catalog.manage and a reason', function (string $role, bool $allowed) {
    $run = fn () => app(ArchiveModField::class)->handle(m31Staff($role), $this->type, true, m33cReason());

    $allowed ? expect($run()->isArchived())->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m33cMatrix());

it('refuses a schema change without reason', function () {
    expect(fn () => app(ArchiveModField::class)->handle($this->staff, $this->type, true, ''))->toThrow(ValidationException::class);
    expect(ModCategorySchemaVersion::query()->count())->toBe(0);
});

it('refuses a type change on a field with data, with the count', function () {
    $vehicle = m23Build('BMW', 'M3', 'E46');
    modIn($vehicle, 'suspension', ['type' => 'coilover']);
    modIn($vehicle, 'suspension', ['type' => 'springs'])->delete();

    expect(fn () => app(UpdateModField::class)->handle($this->staff, $this->type, ['type' => 'text'], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_type_locked')->and($e->count)->toBe(2));
    expect(fn () => app(UpdateModField::class)->handle($this->staff, $this->type, ['key' => 'kind'], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_key_locked'));
    expect($this->type->refresh()->type->value)->toBe('select')->and(ModCategorySchemaVersion::query()->count())->toBe(0);
});

it('refuses narrowing that stored values would fail, and allows the rest', function () {
    $vehicle = m23Build('BMW', 'M3', 'E46');
    modIn($vehicle, 'wheels_tires', ['diameter' => 19.5]);
    $diameter = m33cField('wheels_tires', 'diameter');

    expect(fn () => app(UpdateModField::class)->handle($this->staff, $diameter, ['step' => 1], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_narrowing')->and($e->count)->toBe(1));
    expect(fn () => app(UpdateModField::class)->handle($this->staff, $diameter, ['max' => 19], m33cReason()))->toThrow(CatalogRefused::class);

    app(UpdateModField::class)->handle($this->staff, $diameter, ['min' => 15, 'max' => 23], m33cReason());
    expect($diameter->refresh()->max)->toBe(23.0);

    // Options: removing one nobody uses is fine, removing a used one is not.
    modIn($vehicle, 'suspension', ['type' => 'coilover']);
    $options = collect($this->type->options);
    $withoutOther = $options->reject(fn (array $o) => $o['value'] === 'other')->values()->all();
    app(UpdateModField::class)->handle($this->staff, $this->type, ['options' => $withoutOther], m33cReason());
    expect(fn () => app(UpdateModField::class)->handle($this->staff, $this->type, ['options' => collect($withoutOther)->reject(fn (array $o) => $o['value'] === 'coilover')->values()->all()], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_narrowing'));
});

it('refuses required on a field stored modifications lack', function () {
    modIn(m23Build('Audi', 'RS3'), 'suspension', ['type' => 'coilover']);
    $brand = m33cField('suspension', 'model');

    expect(fn () => app(UpdateModField::class)->handle($this->staff, $brand, ['required' => true], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_narrowing')->and($e->count)->toBe(1));
});

it('archives a field with data instead of deleting it; the API marks it archived and the garage no longer asks for it', function () {
    $vehicle = m23Build('BMW', 'M3', 'E46');
    modIn($vehicle, 'suspension', ['type' => 'coilover', 'adjustable_damping' => true]);
    $damping = m33cField('suspension', 'adjustable_damping');

    expect(fn () => app(DeleteModField::class)->handle($this->staff, $damping, m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('field_has_data')->and($e->count)->toBe(1));

    ModCategoryField::query()->whereKey($this->type->id)->update(['required' => true]);
    app(ArchiveModField::class)->handle($this->staff, $this->type->refresh(), true, m33cReason());
    expect($this->type->refresh()->isArchived())->toBeTrue()->and($this->type->required)->toBeFalse();

    $fields = collect($this->getJson('/api/v1/catalog/mod-categories')->assertOk()->json('data'))->firstWhere('key', 'suspension')['fields'];
    expect(collect($fields)->firstWhere('key', 'type')['archived'])->toBeTrue()->and(collect($fields)->firstWhere('key', 'brand')['archived'])->toBeFalse();

    // The existing modification still shows the archived value.
    Sanctum::actingAs($vehicle->owner);
    $mod = $vehicle->modifications()->firstOrFail();
    $specs = $this->getJson("/api/v1/public/vehicles/{$vehicle->slug}/mods/{$mod->id}")->assertOk()->json('data.specs');
    expect(collect($specs)->pluck('key'))->toContain('type');

    app(ArchiveModField::class)->handle($this->staff, $this->type, false, m33cReason());
    expect($this->type->refresh()->isArchived())->toBeFalse();
});

it('deletes a field without data', function () {
    $field = app(CreateModField::class)->handle($this->staff, $this->suspension, ['key' => 'top_mounts', 'label' => ['de' => 'Domlager', 'en' => 'Top mounts'], 'type' => 'text', 'searchable' => true], m33cReason());

    app(DeleteModField::class)->handle($this->staff, $field, m33cReason());

    expect(ModCategoryField::query()->whereKey($field->id)->exists())->toBeFalse();
    expect(collect(ModCategorySchemaVersion::query()->orderByDesc('version')->firstOrFail()->schema)->pluck('key'))->not->toContain('top_mounts');
});

it('validates field definitions', function (array $input, string $error) {
    expect(fn () => app(CreateModField::class)->handle($this->staff, $this->suspension, ['key' => 'x_field', 'label' => ['de' => 'X', 'en' => 'X'], ...$input], m33cReason()))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey($error));
})->with([
    'unknown type' => [['type' => 'multi'], 'type'],
    'select without options' => [['type' => 'select'], 'options'],
    'bounds on text' => [['type' => 'text', 'min' => 1], 'min'],
    'min over max' => [['type' => 'number', 'min' => 10, 'max' => 5], 'max'],
    'bad pattern' => [['type' => 'text', 'options' => ['pattern' => '(']], 'options.pattern'],
    'bad key' => [['type' => 'text', 'key' => 'X-Field'], 'key'],
    'duplicate option' => [['type' => 'select', 'options' => [['value' => 'a', 'label' => ['de' => 'A', 'en' => 'A']], ['value' => 'a', 'label' => ['de' => 'B', 'en' => 'B']]]], 'options.0.value'],
]);

it('reorders the fields of a category as a whole', function () {
    $ids = ModCategoryField::query()->where('category_id', $this->suspension->id)->orderBy('sort')->pluck('id')->all();

    expect(fn () => app(ReorderModFields::class)->handle($this->staff, $this->suspension, array_slice($ids, 1), m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('fields_mismatch'));

    app(ReorderModFields::class)->handle($this->staff, $this->suspension, array_reverse($ids), m33cReason());
    expect(ModCategoryField::query()->where('category_id', $this->suspension->id)->orderBy('sort')->pluck('id')->all())->toBe(array_reverse($ids));
});

it('creates a category last and swaps sorts on edit, rebuilding the category masks', function () {
    $category = app(CreateModCategory::class)->handle($this->staff, ['key' => 'audio', 'name' => ['de' => 'Audio', 'en' => 'Audio'], 'icon' => 'speaker']);
    expect($category->sort)->toBe(ModCategory::query()->max('sort'));

    $vehicle = m23Build('BMW', 'M3');
    modIn($vehicle, 'suspension', ['type' => 'coilover']);
    $other = ModCategory::query()->where('sort', 1)->firstOrFail();
    $mask = fn () => (int) DB::table('vehicle_search')->where('vehicle_id', $vehicle->id)->value('mod_category_mask');
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);
    expect($mask())->toBe(1 << ($this->suspension->sort - 1));

    app(UpdateModCategory::class)->handle($this->staff, $this->suspension, ['sort' => 1], m33cReason());

    expect($this->suspension->refresh()->sort)->toBe(1)->and($other->refresh()->sort)->not->toBe(1);
    expect($mask())->toBe(1);
    expect(m33cEvents('catalog.category_updated'))->toHaveCount(1);
    expect(fn () => app(UpdateModCategory::class)->handle($this->staff, $this->suspension, ['key' => 'chassis'], m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('category_key_locked'));
});
