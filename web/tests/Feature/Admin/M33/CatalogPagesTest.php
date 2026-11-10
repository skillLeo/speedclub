<?php

use App\Enums\ApprovalStatus;
use App\Enums\CatalogImportStatus;
use App\Enums\CatalogRequestStatus;
use App\Jobs\Catalog\RunCatalogImport;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Brand;
use App\Models\CatalogImport;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModCategorySchemaVersion;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * M3.3 catalogue admin (ADM-14…17, m3.3-contract §2/§3), lane b: the authorisation matrix of every page and write by the 06 §2 role
 * table (catalog.* only for Owner, Admin, Content editor), the recent password on merges, deletes and the import apply, four-eyes that a
 * direct POST cannot bypass, refusals as field errors in words, the CSV export behind lists.export, and the props the pages read.
 */
beforeEach(function () {
    Queue::fake();
    Storage::fake(config()->string('speedclub.media.private_disk'));
    seedModSchema();
});

describe('authorisation matrix', function () {
    it('guards every page by catalog.view (the import by catalog.import)', function (string $uri, string $component) {
        [$make, $model] = adm33Tree();
        $category = ModCategory::query()->orderBy('sort')->firstOrFail();
        $import = CatalogImport::factory()->create();
        $uri = strtr($uri, ['{make}' => (string) $make->id, '{model}' => (string) $model->id, '{category}' => (string) $category->id, '{import}' => $import->id]);

        assertAdminMatrix('GET', $uri, ADM33_CATALOG, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component)));
    })->with([
        'ADM-14 makes' => ['/admin/catalog/makes', 'Catalog/Makes'],
        'ADM-14 make' => ['/admin/catalog/makes/{make}', 'Catalog/Make'],
        'ADM-14 model' => ['/admin/catalog/models/{model}', 'Catalog/Model'],
        'ADM-14 requests' => ['/admin/catalog/requests', 'Catalog/Requests'],
        'ADM-15 categories' => ['/admin/catalog/mod-categories', 'Catalog/ModCategories'],
        'ADM-15 category' => ['/admin/catalog/mod-categories/{category}', 'Catalog/ModCategory'],
        'ADM-16 brands' => ['/admin/catalog/brands', 'Catalog/Brands'],
        'ADM-17 import' => ['/admin/catalog/import', 'Catalog/Import'],
        'ADM-17 import detail' => ['/admin/catalog/import/{import}', 'Catalog/Import'],
    ]);

    it('guards the JSON lookups and downloads', function (string $uri) {
        [$make] = adm33Tree();
        $uri = str_replace('{make}', (string) $make->id, $uri);

        assertAdminMatrix('GET', $uri, ADM33_CATALOG, fn (TestResponse $r) => expect($r->baseResponse->getStatusCode())->toBe(200));
    })->with([
        'impact' => ['/admin/catalog/entries/make/{make}/impact'],
        'request options' => ['/admin/catalog/requests/options'],
        'export' => ['/admin/catalog/export/vehicles.csv'],
        'template' => ['/admin/catalog/import/template/brands.csv'],
    ]);

    it('guards every write by its atom', function (string $method, string $uri, array $data) {
        [$make, $model, $generation] = adm33Tree();
        $request = adm33Request();
        $category = ModCategory::query()->orderBy('sort')->firstOrFail();
        $field = ModCategoryField::query()->where('category_id', $category->id)->orderBy('sort')->firstOrFail();
        $brand = Brand::query()->orderBy('id')->firstOrFail();
        $import = CatalogImport::factory()->create();
        $uri = strtr($uri, ['{make}' => (string) $make->id, '{model}' => (string) $model->id, '{generation}' => (string) $generation->id, '{request}' => $request->id, '{category}' => (string) $category->id, '{field}' => (string) $field->id, '{brand}' => (string) $brand->id, '{import}' => $import->id]);

        adm32WriteMatrix($method, $uri, ADM33_CATALOG, $data);
    })->with([
        'create make' => ['POST', '/admin/catalog/entries/make', ['name' => 'Matrix Motors']],
        'edit model' => ['PATCH', '/admin/catalog/entries/model/{model}', ['name' => 'MF5 Roadster']],
        'deactivate generation' => ['POST', '/admin/catalog/entries/generation/{generation}/active', ['active' => false, 'reason' => adm32Reason()]],
        'merge brand' => ['POST', '/admin/catalog/entries/brand/{brand}/merge', ['target_id' => 0, 'reason' => adm32Reason()]],
        'delete make' => ['DELETE', '/admin/catalog/entries/make/{make}', ['reason' => adm32Reason()]],
        'accept request' => ['POST', '/admin/catalog/requests/{request}/accept', ['make_name' => 'Donkervoort']],
        'reject request' => ['POST', '/admin/catalog/requests/{request}/reject', ['reason' => adm32Reason()]],
        'create category' => ['POST', '/admin/catalog/mod-categories', ['key' => 'matrix_test', 'name' => ['de' => 'Test', 'en' => 'Test']]],
        'edit category' => ['PATCH', '/admin/catalog/mod-categories/{category}', ['icon' => 'wheel', 'reason' => adm32Reason()]],
        'add field' => ['POST', '/admin/catalog/mod-categories/{category}/fields', ['key' => 'matrix_note', 'label' => ['de' => 'Notiz', 'en' => 'Note'], 'type' => 'text', 'reason' => adm32Reason()]],
        'edit field' => ['PATCH', '/admin/catalog/mod-fields/{field}', ['unit' => 'mm', 'reason' => adm32Reason()]],
        'reorder fields' => ['POST', '/admin/catalog/mod-categories/{category}/fields/order', ['ids' => [1], 'reason' => adm32Reason()]],
        'archive field' => ['POST', '/admin/catalog/mod-fields/{field}/archive', ['archived' => true, 'reason' => adm32Reason()]],
        'delete field' => ['DELETE', '/admin/catalog/mod-fields/{field}', ['reason' => adm32Reason()]],
        'upload import' => ['POST', '/admin/catalog/import', ['kind' => 'vehicles']],
        'apply import' => ['POST', '/admin/catalog/import/{import}/apply', ['reason' => adm32Reason()]],
    ]);
});

describe('recent password (ADR-215)', function () {
    it('asks for the password before merges, deletes and the import apply, and changes nothing', function (string $method, string $uri, Closure $unchanged) {
        [$make, , $generation] = adm33Tree();
        $other = Make::factory()->create(['name' => 'Other', 'slug' => 'other']);
        $field = ModCategoryField::factory()->create(['category_id' => ModCategory::query()->orderBy('sort')->value('id'), 'key' => 'stale_check']);
        $import = CatalogImport::factory()->create();
        $uri = strtr($uri, ['{make}' => (string) $make->id, '{generation}' => (string) $generation->id, '{field}' => (string) $field->id, '{import}' => $import->id]);
        seedStaffRoles();
        actingAsStaff(staffWithRole('content_editor'));

        $this->call($method, $uri, ['target_id' => $other->id, 'reason' => adm32Reason()])->assertStatus(303)->assertSessionHas('confirm_password', true);

        expect($unchanged($make, $generation, $field, $import))->toBeTrue();
    })->with([
        'merge' => ['POST', '/admin/catalog/entries/make/{make}/merge', fn (Make $m) => $m->refresh()->merged_into_id === null],
        'delete entry' => ['DELETE', '/admin/catalog/entries/generation/{generation}', fn (Make $m, Generation $g) => Generation::query()->whereKey($g->id)->exists()],
        'delete field' => ['DELETE', '/admin/catalog/mod-fields/{field}', fn (Make $m, Generation $g, ModCategoryField $f) => ModCategoryField::query()->whereKey($f->id)->exists()],
        'apply import' => ['POST', '/admin/catalog/import/{import}/apply', fn (Make $m, Generation $g, ModCategoryField $f, CatalogImport $i) => $i->refresh()->status === CatalogImportStatus::Analysed],
    ]);

    it('needs no password for reversible and versioned edits', function () {
        [, $model] = adm33Tree();
        seedStaffRoles();
        actingAsStaff(staffWithRole('content_editor'));

        $this->patch("/admin/catalog/entries/model/{$model->id}", ['name' => 'MF5 Roadster'])->assertSessionHas('success', 'catalog.flash.updated');
        expect($model->refresh()->name)->toBe('MF5 Roadster');
    });
});

describe('four eyes (ADR-214/229)', function () {
    it('turns a direct merge of more than 100 vehicles into an approval request and merges nothing', function () {
        [$source] = adm33Tree('Merc', 'C63', 'W204', vehicles: 101);
        $target = Make::factory()->create(['name' => 'Mercedes-Benz', 'slug' => 'mercedes-benz']);
        adm32SignedIn('content_editor');

        $this->post("/admin/catalog/entries/make/{$source->id}/merge", ['target_id' => $target->id, 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('approval', fn (array $flash) => $flash['title'] === 'approvals.catalog_bulk_merge.title');

        expect($source->refresh()->merged_into_id)->toBeNull()
            ->and(Vehicle::query()->where('make_id', $target->id)->count())->toBe(0)
            ->and(ApprovalRequest::query()->where('action', 'catalog.bulk_merge')->where('status', ApprovalStatus::Pending)->count())->toBe(1);
    });

    it('turns a direct apply of more than 100 changed rows into an approval request and queues nothing', function () {
        adm32SignedIn('content_editor');
        $lines = ['Marke;Modell'];
        for ($i = 1; $i <= 101; $i++) {
            $lines[] = 'Importmarke;Modell '.$i;
        }
        $this->post('/admin/catalog/import', ['kind' => 'vehicles', 'file' => UploadedFile::fake()->createWithContent('katalog.csv', "\xEF\xBB\xBF".implode("\r\n", $lines))])->assertStatus(303);
        $import = CatalogImport::query()->latest('created_at')->firstOrFail();

        $this->post("/admin/catalog/import/{$import->id}/apply", ['reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('approval', fn (array $flash) => $flash['title'] === 'approvals.catalog_import_apply.title');

        expect($import->refresh()->status)->toBe(CatalogImportStatus::AwaitingApproval)->and(Make::query()->where('slug', 'importmarke')->exists())->toBeFalse();
        Queue::assertNotPushed(RunCatalogImport::class);
    });

    it('runs a small merge directly and says so', function () {
        [$source] = adm33Tree('Toyta', 'Supra', 'A80', vehicles: 2);
        $target = Make::factory()->create(['name' => 'Toyota', 'slug' => 'toyota']);
        adm32SignedIn('admin');

        $this->post("/admin/catalog/entries/make/{$source->id}/merge", ['target_id' => $target->id, 'reason' => adm32Reason()])->assertSessionHas('success', 'catalog.flash.merged');
        expect($source->refresh()->merged_into_id)->toBe($target->id);
    });
});

describe('ADM-14 entries', function () {
    it('lists makes without merged aliases unless asked, with counts and their state', function () {
        [$make] = adm33Tree(vehicles: 2);
        $alias = Make::factory()->create(['name' => 'Wiesman', 'slug' => 'wiesman', 'active' => false, 'merged_into_id' => $make->id]);
        adm32SignedIn('content_editor');

        $this->get('/admin/catalog/makes?filter[q]=wiesm')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
            ->has('rows.data', 1)
            ->where('rows.data.0.slug', 'wiesmann')->where('rows.data.0.models', 1)->where('rows.data.0.vehicles', 2)->where('rows.data.0.merged_into', null)
            ->where('counts.makes', Make::query()->whereNull('merged_into_id')->count()));

        $this->get('/admin/catalog/makes?filter[status]=merged&filter[q]=wiesm')->assertInertia(fn (AssertableInertia $p) => $p
            ->has('rows.data', 1)->where('rows.data.0.id', $alias->id)->where('rows.data.0.merged_into.name', 'Wiesmann'));
    });

    it('creates, edits and deactivates through the Actions, audited', function () {
        adm32SignedIn('content_editor');

        $this->post('/admin/catalog/entries/make', ['name' => 'Ginetta', 'country' => 'gb', 'is_popular' => false])->assertSessionHas('success', 'catalog.flash.created');
        $make = Make::query()->where('slug', 'ginetta')->firstOrFail();
        expect($make->country)->toBe('GB');

        $this->post('/admin/catalog/entries/model', ['name' => 'G40', 'make_id' => $make->id])->assertSessionHas('success');
        $model = VehicleModel::query()->where('make_id', $make->id)->firstOrFail();
        $this->post("/admin/catalog/entries/model/{$model->id}/active", ['active' => false, 'reason' => adm32Reason()])->assertSessionHas('success', 'catalog.flash.deactivated');

        expect($model->refresh()->active)->toBeFalse()
            ->and(AuditEvent::query()->where('action', 'catalog.deactivated')->where('reason', adm32Reason())->exists())->toBeTrue();
    });

    it('needs a reason to deactivate', function () {
        [, $model] = adm33Tree();
        adm32SignedIn('content_editor');

        $this->post("/admin/catalog/entries/model/{$model->id}/active", ['active' => false, 'reason' => 'kurz'])->assertSessionHasErrors('reason');
        expect($model->refresh()->active)->toBeTrue();
    });

    it('answers a taken or locked slug at the slug field, in words', function () {
        [$make, $model] = adm33Tree(vehicles: 1);
        adm32SignedIn('content_editor');

        $this->post('/admin/catalog/entries/make', ['name' => 'Anders', 'slug' => 'wiesmann'])->assertSessionHasErrors(['slug' => 'Dieser Slug ist schon vergeben.']);
        $this->patch("/admin/catalog/entries/model/{$model->id}", ['slug' => 'mf-5'])->assertSessionHasErrors(['slug' => 'Der Slug ist gesperrt: Es verweist schon etwas auf ihn.']);
        expect($model->refresh()->slug)->toBe('mf5');
    });

    it('refuses to delete a referenced entry with what still points at it, and deletes an unused one with its children', function () {
        [$used] = adm33Tree(vehicles: 3);
        [$unused, $unusedModel] = adm33Tree('Leer', 'Nichts', 'Gen');
        adm32SignedIn('content_editor');

        $this->delete("/admin/catalog/entries/make/{$used->id}", ['reason' => adm32Reason()])
            ->assertSessionHasErrors(['refused' => 'Noch in Verwendung, deshalb nicht gelöscht. (Fahrzeuge 3)']);
        expect(Make::query()->whereKey($used->id)->exists())->toBeTrue();

        $this->from("/admin/catalog/makes/{$unused->id}")->delete("/admin/catalog/entries/make/{$unused->id}", ['reason' => adm32Reason(), 'from' => 'record'])
            ->assertRedirect('/admin/catalog/makes')->assertSessionHas('success', 'catalog.flash.deleted');
        expect(Make::query()->whereKey($unused->id)->exists())->toBeFalse()->and(VehicleModel::query()->whereKey($unusedModel->id)->exists())->toBeFalse();
    });

    it('tells the dialogs what a merge or delete would touch, and the survivors with their vehicles', function () {
        [$make, $model] = adm33Tree(vehicles: 2);
        $sibling = VehicleModel::factory()->create(['make_id' => $make->id, 'name' => 'GT MF4', 'slug' => 'gt-mf4']);
        adm32SignedIn('content_editor');

        $this->getJson("/admin/catalog/entries/model/{$model->id}/impact")->assertOk()->assertJson([
            'entry' => ['id' => $model->id, 'vehicles' => 2, 'merged' => false],
            'references' => ['vehicles' => 2],
            'deletable' => false,
            'slug_locked' => true,
            'children' => ['models' => 0, 'generations' => 1],
            'candidates' => [['id' => $sibling->id, 'name' => 'GT MF4', 'vehicles' => 0]],
        ]);
    });

    it('shows a make with its models and a model with its generations', function () {
        [$make, $model, $generation] = adm33Tree(vehicles: 1);
        adm32SignedIn('content_editor');

        $this->get("/admin/catalog/makes/{$make->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('make.vehicles', 1)->has('models', 1)->where('models.0.generations', 1)->where('models.0.vehicles', 1));
        $this->get("/admin/catalog/models/{$model->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('make.name', 'Wiesmann')->has('generations', 1)->where('generations.0.id', $generation->id)->where('generations.0.year_from', 2009));
    });
});

describe('ADM-14 requests', function () {
    it('lists the open requests by default and the closed ones by status', function () {
        $open = adm33Request();
        $closed = adm33Request('Lada', 'Niva', 'nina.adm33');
        $closed->forceFill(['status' => CatalogRequestStatus::Rejected, 'rejection_reason' => 'Bitte als Lada Niva eintragen.'])->save();
        adm32SignedIn('content_editor');

        $this->get('/admin/catalog/requests')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1)->where('rows.data.0.id', $open->id)->where('counts.requests', 1));
        $this->get('/admin/catalog/requests?filter[status]=rejected')->assertInertia(fn (AssertableInertia $p) => $p
            ->has('rows.data', 1)->where('rows.data.0.rejection_reason', 'Bitte als Lada Niva eintragen.'));
    });

    it('accepts: creates the entries, relinks the car and closes the request', function () {
        $request = adm33Request();
        adm32SignedIn('content_editor');

        $this->post("/admin/catalog/requests/{$request->id}/accept", ['make_name' => 'Donkervoort', 'country' => 'NL', 'model_name' => 'D8 GTO'])
            ->assertSessionHas('success', 'catalog.flash.request_accepted');

        $make = Make::query()->where('slug', 'donkervoort')->firstOrFail();
        $vehicle = Vehicle::query()->findOrFail($request->vehicle_id);
        expect($request->refresh()->status)->toBe(CatalogRequestStatus::Approved)->and($vehicle->make_id)->toBe($make->id)->and($vehicle->make_text)->toBeNull();
    });

    it('rejects with a reason and refuses a second answer in words', function () {
        $request = adm33Request();
        adm32SignedIn('content_editor');

        $this->post("/admin/catalog/requests/{$request->id}/reject", ['reason' => 'kurz'])->assertSessionHasErrors('reason');
        $this->post("/admin/catalog/requests/{$request->id}/reject", ['reason' => 'Gibt es schon als Donkervoort D8.'])->assertSessionHas('success', 'catalog.flash.request_rejected');
        $this->post("/admin/catalog/requests/{$request->id}/reject", ['reason' => 'Gibt es schon als Donkervoort D8.'])->assertSessionHasErrors(['refused' => 'Diese Anfrage wurde schon erledigt.']);

        expect($request->refresh()->rejection_reason)->toBe('Gibt es schon als Donkervoort D8.');
    });
});

describe('ADM-15 mod categories', function () {
    it('shows the fields with their data counts, the versions and the five types', function () {
        $category = ModCategory::query()->where('key', 'wheels_tires')->firstOrFail();
        adm32SignedIn('content_editor');

        $this->get("/admin/catalog/mod-categories/{$category->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('category.key', 'wheels_tires')
            ->has('fields.0.data')->has('fields.0.facet')->has('fields.0.searchable')
            ->where('versions', [])
            ->where('types', ['text', 'number', 'boolean', 'select', 'brand']));
    });

    it('versions each field change and ignores facet and searchable from the page (ADR-235)', function () {
        $category = ModCategory::query()->where('key', 'wheels_tires')->firstOrFail();
        $field = ModCategoryField::query()->where('category_id', $category->id)->orderBy('sort')->firstOrFail();
        $before = ['facet' => (bool) $field->facet, 'searchable' => (bool) $field->searchable];
        adm32SignedIn('content_editor');

        $this->patch("/admin/catalog/mod-fields/{$field->id}", ['unit' => 'Zoll', 'facet' => ! $before['facet'], 'searchable' => ! $before['searchable'], 'reason' => adm32Reason()])
            ->assertSessionHas('success', 'catalog.flash.field_updated');

        $field->refresh();
        expect($field->unit)->toBe('Zoll')->and((bool) $field->facet)->toBe($before['facet'])->and((bool) $field->searchable)->toBe($before['searchable'])
            ->and(ModCategorySchemaVersion::query()->where('category_id', $category->id)->pluck('version')->sort()->values()->all())->toBe([1, 2]);
    });

    it('refuses a type change on a field with data at the type field, with the count', function () {
        $vehicle = m23Build('BMW', 'M3', 'E46', mods: [['wheels_tires', ['diameter' => 19]]]);
        $field = ModCategoryField::query()->where('key', 'diameter')->firstOrFail();
        adm32SignedIn('content_editor');

        $this->patch("/admin/catalog/mod-fields/{$field->id}", ['type' => 'text', 'reason' => adm32Reason()])->assertSessionHasErrors(['type' => 'Der Typ ist fest, das Feld hat Daten in 1 Mod.']);
        $this->delete("/admin/catalog/mod-fields/{$field->id}", ['reason' => adm32Reason()])->assertSessionHasErrors(['refused' => 'Das Feld hat Daten in 1 Mod. Archiviere es stattdessen.']);
        expect($field->refresh()->type->value)->toBe('number')->and($vehicle->exists)->toBeTrue();
    });

    it('creates a category and lands on its page', function () {
        adm32SignedIn('content_editor');

        $response = $this->post('/admin/catalog/mod-categories', ['key' => 'aero_parts', 'name' => ['de' => 'Aero', 'en' => 'Aero']]);
        $category = ModCategory::query()->where('key', 'aero_parts')->firstOrFail();
        $response->assertRedirect("/admin/catalog/mod-categories/{$category->id}");
    });
});

describe('ADM-16 brands', function () {
    it('lists brands with usage and aliases and suggests merges of equal spellings', function () {
        $exact = Brand::factory()->create(['name' => 'Testovič', 'slug' => 'testovic-exact', 'aliases' => ['Testo']]);
        Brand::factory()->create(['name' => 'TESTOVIC', 'slug' => 'testovic-caps']);
        adm32SignedIn('content_editor');

        $this->get('/admin/catalog/brands?filter[q]=testov')->assertInertia(fn (AssertableInertia $p) => $p
            ->has('rows.data', 2)->where('rows.data.0.id', $exact->id)->where('rows.data.0.aliases', ['Testo'])
            ->where('suggestions', fn ($s) => collect($s)->contains(fn ($g) => $g['survivor']['id'] === $exact->id))
            ->has('categories'));
    });

    it('saves aliases from the chips', function () {
        $brand = Brand::factory()->create(['name' => 'Chipmarke', 'slug' => 'chipmarke']);
        adm32SignedIn('content_editor');

        $this->patch("/admin/catalog/entries/brand/{$brand->id}", ['aliases' => ['Chip', 'Chip-Marke']])->assertSessionHas('success');
        expect($brand->refresh()->aliases)->toBe(['Chip', 'Chip-Marke']);
    });
});

describe('ADM-17 import', function () {
    it('dry-runs an upload without touching the catalogue and shows the rows with their codes', function () {
        adm32SignedIn('content_editor');
        $csv = "\xEF\xBB\xBFMarke;Modell;Land\r\nGinetta;G40;GB\r\n;Ohne Marke;\r\n";

        $this->post('/admin/catalog/import', ['kind' => 'vehicles', 'file' => UploadedFile::fake()->createWithContent('neu.csv', $csv)])->assertSessionHas('success', 'catalog.flash.import_analysed');
        $import = CatalogImport::query()->latest('created_at')->firstOrFail();

        expect(Make::query()->where('slug', 'ginetta')->exists())->toBeFalse();
        $this->get("/admin/catalog/import/{$import->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('current.id', $import->id)->where('current.status', 'analysed')->where('current.can_apply', true)
            ->where('current.lines.0.status', 'new')->where('current.lines.1.error.code', 'make_missing')
            ->missing('current.lines.0.data')
            ->where('history.0.id', $import->id));
    });

    it('answers an unreadable file at the file field', function () {
        adm32SignedIn('content_editor');

        $this->post('/admin/catalog/import', ['kind' => 'vehicles', 'file' => UploadedFile::fake()->createWithContent('falsch.csv', "Unbekannt;Spalte\r\nx;y\r\n")])->assertSessionHasErrors('file');
        expect(CatalogImport::query()->count())->toBe(0);
    });

    it('queues a small apply as the staff member, with the reason', function () {
        adm32SignedIn('content_editor');
        $this->post('/admin/catalog/import', ['kind' => 'brands', 'file' => UploadedFile::fake()->createWithContent('marken.csv', "Marke;Slug;Kategorie;Aliase\r\nNeumarke;;;\r\n")]);
        $import = CatalogImport::query()->latest('created_at')->firstOrFail();

        $this->post("/admin/catalog/import/{$import->id}/apply", ['reason' => adm32Reason()])->assertSessionHas('success', 'catalog.flash.import_queued');
        expect($import->refresh()->status)->toBe(CatalogImportStatus::Queued)->and($import->reason)->toBe(adm32Reason());
        Queue::assertPushed(RunCatalogImport::class);
    });

    it('hands out the template and the export as German Excel CSV, audited', function () {
        adm32SignedIn('content_editor');

        $template = $this->get('/admin/catalog/import/template/vehicles.csv')->assertOk();
        expect($template->getContent())->toStartWith("\xEF\xBB\xBFMarke;");
        $export = $this->get('/admin/catalog/export/brands.csv')->assertOk();
        expect($export->streamedContent())->toStartWith("\xEF\xBB\xBF");
        expect(AuditEvent::query()->where('action', 'catalog.exported')->count())->toBe(2);
        $this->get('/admin/catalog/export/unknown.csv')->assertNotFound();
    });
});
