<?php

use App\Actions\Admin\Catalog\AnalyseCatalogImport;
use App\Actions\Admin\Catalog\ApplyCatalogImport;
use App\Actions\Admin\Catalog\CreateCatalogEntry;
use App\Actions\Admin\Catalog\RecordCatalogExport;
use App\Enums\ApprovalStatus;
use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use App\Enums\CatalogLevel;
use App\Jobs\Catalog\PruneCatalogImports;
use App\Jobs\Catalog\RunCatalogImport;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Brand;
use App\Models\CatalogImport;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogCsvWriter;
use App\Services\Catalog\CatalogImportApplier;
use App\Services\Catalog\CatalogImportPlanner;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/CatalogHelpers.php';

/**
 * M3.3 ADM-17 CSV import: German Excel files parse, the dry run changes nothing, bad rows are reported one by one, the apply runs the
 * manual edit's Actions in a queued job, more than 100 changed rows need four eyes, exports are formula-safe.
 */
beforeEach(function () {
    seedModSchema();
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->staff = m33cEditor();
});

function m33cCsv(array $lines, string $delimiter = ';', bool $bom = true, string $eol = "\r\n"): string
{
    return ($bom ? "\xEF\xBB\xBF" : '').implode($eol, $lines).$eol;
}

function m33cAnalyse(string $csv, CatalogImportKind $kind = CatalogImportKind::Vehicles): CatalogImport
{
    return app(AnalyseCatalogImport::class)->handle(test()->staff, $kind, $csv, 'katalog.csv');
}

it('reads a German Excel export: BOM, semicolons, CRLF, quotes with line breaks and semicolons', function () {
    $parsed = CatalogCsv::parse(m33cCsv([
        'Marke;Land;Beliebt;Modell;Generation;Baujahr von;Baujahr bis',
        'Mercedes-Benz;DE;ja;"C-Klasse; AMG";W205;2014;2021',
        '"Škoda";CZ;nein;"Octavia ""RS""";"1Z'."\r\n".'Facelift";2008;2013',
    ]));

    expect($parsed['delimiter'])->toBe(';')->and($parsed['header'][0])->toBe('Marke');
    expect($parsed['rows'])->toHaveCount(2)
        ->and($parsed['rows'][0]['cells'][3])->toBe('C-Klasse; AMG')
        ->and($parsed['rows'][1]['cells'][0])->toBe('Škoda')
        ->and($parsed['rows'][1]['cells'][3])->toBe('Octavia "RS"')
        ->and($parsed['rows'][1]['cells'][4])->toBe("1Z\r\nFacelift");
});

it('reads commas, LF without BOM, Windows-1252 and our own formula-safe cells', function () {
    $parsed = CatalogCsv::parse(m33cCsv(['make,model', "Citro\xEBn,C4", "'=Evil,'-5"], ',', bom: false, eol: "\n"));

    expect($parsed['delimiter'])->toBe(',')->and($parsed['rows'][0]['cells'][0])->toBe('Citroën')->and($parsed['rows'][1]['cells'])->toBe(['=Evil', '-5']);
});

it('refuses files it cannot read as a whole', function (string $csv) {
    expect(fn () => m33cAnalyse($csv))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('file'));
})->with([
    'empty' => [''],
    'unknown column' => [m33cCsv(['Marke;Farbe', 'BMW;Rot'])],
    'missing make' => [m33cCsv(['Modell', 'M4'])],
    'repeated column' => [m33cCsv(['Marke;make', 'BMW;BMW'])],
]);

it('dry-runs without touching the catalogue and reports each row', function () {
    $make = Make::factory()->create(['name' => 'BMW', 'slug' => 'bmw', 'country' => 'DE', 'is_popular' => false]);
    Make::factory()->create(['name' => 'Mini', 'slug' => 'mini', 'country' => 'GB']);
    $makes = Make::query()->count();

    $import = m33cAnalyse(m33cCsv([
        'Marke;Land;Beliebt;Modell;Generation;Baujahr von;Baujahr bis;Aktiv',
        'Mini;GB;;;;;;',
        'BMW;;ja;;;;;',
        'BMW;;;M4;G82;2021;;',
        'BMW;;;M4;G83;2021;;',
        ';;;M3;;;;',
        'Audi;Deutschland;;;;;;',
        'BMW;;;;G80;;;',
        'BMW;;;M4;G82;2021;;',
        'BMW;;;M5;F90;2020;2017;',
        'Audi;;vielleicht;;;;;',
    ]));

    expect(Make::query()->count())->toBe($makes)->and(VehicleModel::query()->count())->toBe(0)->and($make->refresh()->is_popular)->toBeFalse();
    expect(AuditEvent::query()->pluck('action')->unique()->values()->all())->toBe(['catalog.import_analysed']);
    expect($import->status)->toBe(CatalogImportStatus::Analysed)->and($import->row_count)->toBe(10);
    expect($import->counts)->toBe(['new' => 2, 'changed' => 1, 'unchanged' => 1, 'error' => 6]);

    $rows = collect($import->rows);
    expect($rows->pluck('status')->all())->toBe(['unchanged', 'changed', 'new', 'new', 'error', 'error', 'error', 'error', 'error', 'error']);
    expect($rows[1]['changes'])->toBe(['make.is_popular' => [false, true]])->and($rows[2]['creates'])->toBe(['model', 'generation'])->and($rows[3]['creates'])->toBe(['generation']);
    expect($rows->slice(4)->pluck('error.code')->values()->all())->toBe(['make_missing', 'invalid_country', 'generation_needs_model', 'duplicate', 'year_order', 'invalid_boolean']);
    expect($rows[7]['error']['params'])->toBe(['line' => 4]);
    Storage::disk(config()->string('speedclub.media.private_disk'))->assertExists($import->path);
});

it('applies through the manual Actions in the queue: audited per entry and equal to manual edits', function () {
    $import = m33cAnalyse(m33cCsv([
        'Marke;Land;Beliebt;Modell;Generation;Baujahr von;Baujahr bis',
        'Alpine;FR;ja;A110;;;',
        'Alpine;;;A110;AS1;2017;',
        'Alpine;;;A290;;;',
        ';;;Fehler;;;',
    ]));

    $queued = app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason());

    expect($queued)->toBeInstanceOf(CatalogImport::class);
    $import->refresh();
    expect($import->status)->toBe(CatalogImportStatus::Applied)->and($import->progress)->toBe(4)->and(collect($import->results)->pluck('status')->all())->toBe(['new', 'new', 'new', 'error']);
    $alpine = Make::query()->where('slug', 'alpine')->firstOrFail();
    expect($alpine->country)->toBe('FR')->and($alpine->is_popular)->toBeTrue();
    expect(VehicleModel::query()->where('make_id', $alpine->id)->pluck('slug')->sort()->values()->all())->toBe(['a110', 'a290']);
    expect(Generation::query()->where('slug', 'as1')->value('year_from'))->toBe(2017);

    // The same as a manual edit: one catalog.created per entry, by the staff member, with the import's reason.
    $created = m33cEvents('catalog.created');
    expect($created)->toHaveCount(4)->and($created[0]->actor_id)->toBe((string) $this->staff->id)->and($created[0]->reason)->toContain('katalog.csv')->toContain(m33cReason());
    expect(m33cEvents('catalog.import_started')[0]->after)->toMatchArray(['records' => 3, 'approved_by' => null]);
    expect(m33cEvents('catalog.import_finished')[0]->after)->toMatchArray(['status' => 'applied', 'new' => 3, 'error' => 1]);

    // Applying the same file again changes nothing.
    $again = m33cAnalyse(m33cCsv(['Marke;Land;Beliebt;Modell;Generation;Baujahr von;Baujahr bis', 'Alpine;FR;ja;A110;;;', 'Alpine;;;A110;AS1;2017;']));
    expect($again->counts)->toMatchArray(['new' => 0, 'changed' => 0, 'unchanged' => 2]);
});

it('applies brands: new ones, hints and added aliases', function () {
    Brand::query()->where('slug', 'bbs')->update(['aliases' => null]);
    $import = m33cAnalyse(m33cCsv(['Marke;Slug;Kategorie;Aliase', 'BBS;;wheels_tires;B.B.S.|BBS Motorsport', 'Felgenwerk Nord;;wheels_tires;', 'Foo;;keine;'], ';'), CatalogImportKind::Brands);

    expect($import->counts)->toMatchArray(['changed' => 1, 'new' => 1, 'error' => 1]);
    app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason());

    expect(Brand::query()->where('slug', 'bbs')->firstOrFail()->aliases)->toBe(['B.B.S.', 'BBS Motorsport']);
    expect(Brand::query()->where('slug', 'felgenwerk-nord')->value('category_hint'))->toBe('wheels_tires');
});

it('needs catalog.import and catalog.manage', function (string $role, bool $allowed) {
    $staff = m31Staff($role);
    $run = fn () => app(AnalyseCatalogImport::class)->handle($staff, CatalogImportKind::Vehicles, m33cCsv(['Marke', 'BMW']), 'a.csv');

    $allowed ? expect($run()->status)->toBe(CatalogImportStatus::Analysed) : expect($run)->toThrow(AuthorizationException::class);
})->with(m33cMatrix());

it('asks for four eyes above 100 changed rows and applies after approval', function () {
    Queue::fake([RunCatalogImport::class]);
    $lines = ['Marke;Modell'];

    for ($i = 1; $i <= 101; $i++) {
        $lines[] = 'Importmarke;Modell '.$i;
    }

    $import = m33cAnalyse(m33cCsv($lines));
    $approval = app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason());

    expect($approval)->toBeInstanceOf(ApprovalRequest::class)->and($approval->action)->toBe('catalog.import_apply');
    expect($import->refresh()->status)->toBe(CatalogImportStatus::AwaitingApproval);
    expect(fn () => app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason()))->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('import_state'));
    expect(fn () => app(ApplyCatalogImport::class)->execute($this->staff, m31Staff('owner'), $import, m33cReason()))->toThrow(AuthorizationException::class);
    Queue::assertNothingPushed();

    $done = m33cApprove($approval);

    expect($done->status)->toBe(ApprovalStatus::Executed)->and($import->refresh()->status)->toBe(CatalogImportStatus::Queued)->and($import->approved_by)->not->toBeNull();
    Queue::assertPushed(RunCatalogImport::class, 1);

    (new RunCatalogImport($import->id))->handle(app(CatalogImportPlanner::class), app(CatalogImportApplier::class));
    expect(VehicleModel::query()->count())->toBe(101)->and($import->refresh()->status)->toBe(CatalogImportStatus::Applied);
});

it('resumes an interrupted apply from its progress', function () {
    Queue::fake([RunCatalogImport::class]);
    $import = m33cAnalyse(m33cCsv(['Marke;Modell', 'Lotus;Emira', 'Lotus;Exige', 'Lotus;Evora']));
    app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason());
    // A first run applied the first row and died.
    app(CreateCatalogEntry::class)->handle($this->staff, CatalogLevel::Make, ['name' => 'Lotus']);
    $import->refresh()->forceFill(['status' => CatalogImportStatus::Applying, 'progress' => 1, 'results' => [['line' => 2, 'status' => 'new', 'error' => null]], 'updated_at' => now()->subHour()])->save();
    CatalogImport::query()->whereKey($import->id)->update(['updated_at' => now()->subHour()]);

    (new PruneCatalogImports)->handle();
    Queue::assertPushed(RunCatalogImport::class, fn (RunCatalogImport $job) => $job->importId === $import->id);

    (new RunCatalogImport($import->id))->handle(app(CatalogImportPlanner::class), app(CatalogImportApplier::class));
    expect($import->refresh()->status)->toBe(CatalogImportStatus::Applied)->and(collect($import->results)->pluck('line')->all())->toBe([2, 3, 4]);
    expect(VehicleModel::query()->pluck('slug')->sort()->values()->all())->toBe(['evora', 'exige']);
});

it('fails an apply whose file changed', function () {
    $import = m33cAnalyse(m33cCsv(['Marke', 'Ginetta']));
    Storage::disk(config()->string('speedclub.media.private_disk'))->put($import->path, m33cCsv(['Marke', 'Bösartig']));

    expect(fn () => app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason()))
        ->toThrow(fn (CatalogRefused $e) => expect($e->reason)->toBe('import_file_changed'));
    expect(Make::query()->where('slug', 'ginetta')->exists())->toBeFalse();
});

it('removes files after 30 days and keeps the report', function () {
    $import = m33cAnalyse(m33cCsv(['Marke', 'Ginetta']));
    $import->forceFill(['expires_at' => now()->subMinute()])->save();

    (new PruneCatalogImports)->handle();

    Storage::disk(config()->string('speedclub.media.private_disk'))->assertMissing($import->path);
    expect($import->refresh()->status)->toBe(CatalogImportStatus::Expired)->and($import->rows)->not->toBeEmpty();
    expect(fn () => app(ApplyCatalogImport::class)->handle($this->staff, $import, m33cReason()))->toThrow(CatalogRefused::class);
});

it('exports formula-safe CSV in the import format, which imports back unchanged', function () {
    Make::factory()->create(['name' => '=HYPERLINK("x")', 'slug' => 'hyperlink-x']);
    $model = VehicleModel::factory()->create(['make_id' => Make::factory()->create(['name' => '@Cmd', 'slug' => 'cmd'])->id, 'name' => '+Plus', 'slug' => 'plus']);
    Generation::factory()->create(['model_id' => $model->id, 'name' => '-Minus', 'slug' => 'minus', 'year_from' => 2001, 'year_to' => 2005]);
    Brand::query()->create(['name' => '=Brand', 'slug' => 'brand-x', 'aliases' => ['@a']]);

    app(RecordCatalogExport::class)->handle($this->staff, CatalogImportKind::Vehicles);
    $out = fopen('php://memory', 'r+');
    $count = CatalogCsvWriter::export(CatalogImportKind::Vehicles, $out);
    rewind($out);
    $csv = (string) stream_get_contents($out);

    expect($csv)->toStartWith("\xEF\xBB\xBFMarke;\"Marke slug\";")->toContain("\r\n")
        ->toContain('"\'=HYPERLINK(""x"")"')->toContain("'@Cmd")->toContain("'+Plus")->toContain("'-Minus")
        ->not->toMatch('/(^|;)[=+\-@]/m');
    expect($count)->toBe(2)->and(m33cEvents('catalog.exported'))->toHaveCount(1);

    $brands = fopen('php://memory', 'r+');
    CatalogCsvWriter::export(CatalogImportKind::Brands, $brands);
    rewind($brands);
    expect((string) stream_get_contents($brands))->toContain("'=Brand")->toContain("'@a");

    expect(m33cAnalyse($csv)->counts)->toMatchArray(['new' => 0, 'changed' => 0, 'error' => 0]);
    expect(m33cAnalyse(CatalogCsvWriter::template(CatalogImportKind::Vehicles))->counts)->toMatchArray(['error' => 0]);
    expect(m33cAnalyse(CatalogCsvWriter::template(CatalogImportKind::Brands), CatalogImportKind::Brands)->counts)->toMatchArray(['error' => 0]);
});

it('refuses an analyst the export', function () {
    expect(fn () => app(RecordCatalogExport::class)->handle(m31Staff('analyst'), CatalogImportKind::Brands))->toThrow(AuthorizationException::class);
});
