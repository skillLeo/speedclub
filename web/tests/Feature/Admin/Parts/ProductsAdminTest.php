<?php

use App\Actions\Admin\Catalog\AnalyseCatalogImport;
use App\Actions\Admin\Catalog\ApplyCatalogImport;
use App\Enums\CatalogImportKind;
use App\Enums\ProductStatus;
use App\Models\AuditEvent;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Product;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Businesses/BusinessTestHelpers.php';

/**
 * ADM-57 Teile & Produkte (09 §8.9, §10.3; M4.14 backend): the role matrix (catalog.view / catalog.manage), create, edit, archive,
 * restore and merge with audit, and the ADM-17 CSV import of the kind `products` (dry run, then apply through the same Action).
 */
const PRODUCT_ADMIN_VIEW = ['owner', 'admin', 'content_editor', 'analyst', 'moderator', 'support'];
const PRODUCT_ADMIN_MANAGE = ['owner', 'admin', 'content_editor'];

beforeEach(function () {
    seedModSchema();
    $this->kw = Brand::query()->where('slug', 'kw')->firstOrFail();
    $this->suspension = ModCategory::query()->where('key', 'suspension')->firstOrFail();
    $this->product = Product::factory()->create(['brand_id' => $this->kw->id, 'category_id' => $this->suspension->id, 'name' => 'Variante 3', 'slug' => 'variante-3']);
});

function productsAdminAs(string $role): mixed
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

it('guards the product pages by catalog.view', function (string $uri, string $component) {
    seedStaffRoles();
    $view = array_values(array_filter(ADMIN_ROLES, fn (string $role): bool => staffWithRole($role)->can('catalog.view')));
    $uri = str_replace('{product}', $this->product->id, $uri);

    assertAdminMatrix('GET', $uri, $view, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component, false)));
})->with([
    'ADM-57 table' => ['/admin/catalog/products', 'Catalog/Products'],
    'ADM-57 record' => ['/admin/catalog/products/{product}', 'Catalog/ProductShow'],
]);

it('guards the writes by catalog.manage', function (string $method, string $uri, array $data) {
    seedStaffRoles();
    $manage = array_values(array_filter(ADMIN_ROLES, fn (string $role): bool => staffWithRole($role)->can('catalog.manage')));
    $uri = str_replace('{product}', $this->product->id, $uri);

    assertAdminMatrix($method, $uri, $manage, fn (TestResponse $r) => expect($r->status())->toBeIn([200, 201, 302, 303, 423]), $data);
})->with([
    'create' => ['POST', '/admin/catalog/products', ['brand_id' => 0, 'category_id' => 0, 'name' => 'X']],
    'edit' => ['PATCH', '/admin/catalog/products/{product}', ['line' => 'Gewindefahrwerke']],
    'archive' => ['POST', '/admin/catalog/products/{product}/archive', ['reason' => 'Nicht mehr im Programm des Herstellers.']],
]);

it('creates, edits, archives, restores and merges with audit; the merge moves the mods', function () {
    productsAdminAs('content_editor');

    $this->postJson('/admin/catalog/products', ['brand_id' => $this->kw->id, 'category_id' => $this->suspension->id, 'name' => 'Variante 1', 'attributes' => ['de' => ['Bauart' => 'Gewindefahrwerk']]])
        ->assertCreated();
    $v1 = Product::query()->where('slug', 'variante-1')->firstOrFail();
    expect($v1->attributeTable('de'))->toBe(['Bauart' => 'Gewindefahrwerk'])
        ->and(AuditEvent::query()->where('action', 'product.created')->count())->toBe(1);

    $this->patchJson("/admin/catalog/products/{$v1->id}", ['line' => 'Gewindefahrwerke', 'url' => 'http://insecure.test'])->assertUnprocessable();
    $this->patchJson("/admin/catalog/products/{$v1->id}", ['line' => 'Gewindefahrwerke'])->assertOk();
    expect(AuditEvent::query()->where('action', 'product.updated')->value('after'))->toMatchArray(['line' => 'Gewindefahrwerke']);

    $this->postJson("/admin/catalog/products/{$v1->id}/archive", ['reason' => 'kurz'])->assertUnprocessable();
    $this->postJson("/admin/catalog/products/{$v1->id}/archive", ['reason' => 'Nicht mehr im Programm des Herstellers.'])->assertOk()->assertJsonPath('status', 'archived');
    $this->postJson("/admin/catalog/products/{$v1->id}/restore", ['reason' => 'Doch wieder lieferbar laut Hersteller.'])->assertOk()->assertJsonPath('status', 'active');

    $mod = bizBuildWithMod(null, $v1);
    $this->postJson("/admin/catalog/products/{$v1->id}/merge", ['reason' => 'Doppelt angelegt, gleiche Produktlinie.', 'into' => $this->product->id])->assertOk();
    expect($mod->refresh()->product_id)->toBe($this->product->id)
        ->and($v1->refresh()->merged_into_id)->toBe($this->product->id)->and($v1->status)->toBe(ProductStatus::Archived)
        ->and($this->product->refresh()->aliases)->toContain('Variante 1')
        ->and(AuditEvent::query()->where('action', 'product.merged')->value('after'))->toMatchArray(['into' => $this->product->id, 'mods' => 1]);
});

it('needs the recent password for a merge', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('admin'));
    $other = Product::factory()->create(['brand_id' => $this->kw->id, 'category_id' => $this->suspension->id]);

    expect($this->post("/admin/catalog/products/{$other->id}/merge", ['reason' => 'Doppelt angelegt, gleiche Produktlinie.', 'into' => $this->product->id])->status())->toBeIn([302, 303, 423]);
    expect($other->refresh()->merged_into_id)->toBeNull();
});

it('imports products from CSV: dry run first, then the same Action as a manual edit', function () {
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $staff = productsAdminAs('content_editor');
    $csv = "\xEF\xBB\xBFMarke;Produkt;Linie;Kategorie;URL\r\nKW;Variante 3;Gewindefahrwerke;suspension;\r\nKW;Clubsport 2-Wege;Gewindefahrwerke;suspension;\r\nErfunden;Teil;;suspension;\r\nKW;Teil;;keine;\r\n";

    $import = app(AnalyseCatalogImport::class)->handle($staff, CatalogImportKind::Products, $csv, 'teile.csv');
    expect($import->counts)->toMatchArray(['new' => 1, 'changed' => 1, 'error' => 2])
        ->and(Product::query()->count())->toBe(1);

    app(ApplyCatalogImport::class)->handle($staff, $import, 'Teilekatalog aus der Herstellerliste ergänzt.');
    expect(Product::query()->where('slug', 'clubsport-2-wege')->exists())->toBeTrue()
        ->and($this->product->refresh()->line)->toBe('Gewindefahrwerke')
        ->and(Modification::query()->count())->toBe(0);
});
