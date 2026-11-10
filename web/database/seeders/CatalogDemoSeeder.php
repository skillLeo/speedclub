<?php

namespace Database\Seeders;

use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use App\Enums\CatalogRequestStatus;
use App\Models\Brand;
use App\Models\CatalogImport;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategorySchemaVersion;
use App\Models\Staff;
use App\Models\User;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogImportPlanner;
use App\Services\Catalog\SchemaVersions;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * The catalogue admin's demo state for ADM-14…17 and the visual matrix (M3.3): member requests (open, accepted, rejected), a merged make
 * and model alias and an inactive make and generation (new rows only, so no picker the app shows changes), a brand spelled twice for
 * "Normalisieren" and one merged brand, two schema versions of Räder & Reifen whose latest equals the seeded schema, and five CSV imports
 * (a dry run with every row status, an applied one with a failed row, one running, one failed, one expired). Fixed ids and dates relative
 * to DemoSeeder::NOW, so every run draws the same pictures; re-running it puts the same state back. Needs the DemoSeeder members and the
 * StaffSeeder demo staff; the running import has no file, so a resumed job can only end it as failed.
 */
class CatalogDemoSeeder extends Seeder
{
    public const DRY_RUN = '01m66awqg0c4tr3q1mp0rt0001';

    private CarbonImmutable $now;

    public function run(): void
    {
        $this->now = CarbonImmutable::parse(DemoSeeder::NOW);
        $editor = Staff::query()->where('email', 'content-editor@speedclub.test')->first();
        $owner = Staff::query()->where('email', 'owner@speedclub.test')->first();

        // Rows without a date of their own (an alias, a brand) are dated NOW, never the wall clock (DQ-677).
        SeedClock::at($this->now, function () use ($editor, $owner): void {
            DB::transaction(function () use ($editor): void {
                $this->entries();
                $this->brands();
                $this->requests($editor);
                $this->versions($editor);
            });

            $this->imports($editor, $owner);
        });
    }

    private function entries(): void
    {
        $mercedes = Make::query()->where('slug', 'mercedes-benz')->first();
        if ($mercedes !== null) {
            $this->make('mercedes', ['name' => 'Mercedes', 'country' => 'DE', 'is_popular' => false, 'sort' => 900, 'active' => false, 'merged_into_id' => $mercedes->id]);
        }
        $this->make('trabant', ['name' => 'Trabant', 'country' => 'DE', 'is_popular' => false, 'sort' => 901, 'active' => false, 'merged_into_id' => null]);

        $bmw = Make::query()->where('slug', 'bmw')->first();
        $m3 = $bmw === null ? null : VehicleModel::query()->where('make_id', $bmw->id)->where('slug', 'm3')->first();

        if ($bmw !== null && $m3 !== null) {
            VehicleModel::query()->updateOrCreate(['make_id' => $bmw->id, 'slug' => 'm3-limousine'], ['name' => 'M3 Limousine', 'active' => false])
                ->forceFill(['merged_into_id' => $m3->id])->save();
            Generation::query()->updateOrCreate(['model_id' => $m3->id, 'slug' => 'e30-evo'], ['name' => 'E30 Evo', 'year_from' => 1988, 'year_to' => 1990, 'active' => false]);
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function make(string $slug, array $attributes): void
    {
        $make = Make::query()->firstOrNew(['slug' => $slug]);
        $make->forceFill([...$attributes, 'slug' => $slug])->save();
    }

    private function brands(): void
    {
        // "Normalisieren": the same brand typed without its háček, unused; the seeded "Akrapovič" is the suggested survivor.
        Brand::query()->firstOrNew(['slug' => 'akrapovic-auspuff'])->forceFill(['name' => 'AKRAPOVIC', 'category_hint' => 'exhaust', 'aliases' => null, 'merged_into_id' => null])->save();
        $hr = Brand::query()->where('slug', 'h-r')->first();
        if ($hr !== null) {
            Brand::query()->firstOrNew(['slug' => 'h-r-federn'])->forceFill(['name' => 'H&R Federn', 'category_hint' => 'suspension', 'aliases' => null, 'merged_into_id' => $hr->id])->save();
        }
    }

    private function requests(?Staff $editor): void
    {
        $rows = [
            ['01m66awqg0c4tr3q0000000001', 'paul.roadster', 'Wiesmann', 'MF5', 'Roadster', CatalogRequestStatus::Pending, 50, null],
            ['01m66awqg0c4tr3q0000000002', 'nico.sti', 'Donkervoort', 'D8 GTO', null, CatalogRequestStatus::Pending, 26, null],
            ['01m66awqg0c4tr3q0000000003', 'aylin.vtec', 'Honda', 'Civic Type R', 'EK9 Spoon', CatalogRequestStatus::Pending, 5, null],
            ['01m66awqg0c4tr3q0000000004', 'kenji.r34', 'Alpina', 'B3 Touring', 'E91', CatalogRequestStatus::Pending, 74, null],
            ['01m66awqg0c4tr3q0000000005', 'tobi.quattro', 'Audi', 'RS 2 Avant', null, CatalogRequestStatus::Approved, 150, null],
            ['01m66awqg0c4tr3q0000000006', 'marco.amg', 'Mercedes', 'AMG Eigenbau', null, CatalogRequestStatus::Rejected, 196, 'Bitte wähle Mercedes-Benz C 63 AMG und trag den Umbau als Mod ein.'],
        ];

        foreach ($rows as [$id, $username, $make, $model, $generation, $status, $hoursAgo, $reason]) {
            $user = User::query()->where('username', $username)->first();
            $at = $this->now->subHours($hoursAgo);
            $request = CatalogRequest::query()->find($id) ?? new CatalogRequest;
            $request->forceFill([
                'id' => $id,
                'user_id' => $user?->getKey(),
                'vehicle_id' => null,
                'make_text' => $make,
                'model_text' => $model,
                'generation_text' => $generation,
                'status' => $status,
                'rejection_reason' => $reason,
                'resolved_by' => $status === CatalogRequestStatus::Pending ? null : $editor?->getKey(),
                'resolved_at' => $status === CatalogRequestStatus::Pending ? null : $at->addHours(20),
                'created_at' => $at,
                'updated_at' => $at,
            ]);
            $request->timestamps = false;
            $request->save();
        }
    }

    /**
     * Räder & Reifen: version 1 (the seeded start, the spacers without unit) and version 2 (the unit "mm" added), equal to what is stored.
     */
    private function versions(?Staff $editor): void
    {
        $category = ModCategory::query()->where('key', 'wheels_tires')->first();
        if ($category === null) {
            return;
        }

        $now = SchemaVersions::snapshot($category);
        $before = array_map(fn (array $field): array => str_starts_with((string) $field['key'], 'spacer_') ? [...$field, 'unit' => null] : $field, $now);

        foreach ([[1, $before, null, null, 240], [2, $now, $editor?->getKey(), 'Einheit mm für die Spurverbreiterungen ergänzt (Ticket SC-0412).', 216]] as [$version, $schema, $staff, $reason, $hoursAgo]) {
            $row = ModCategorySchemaVersion::query()->where('category_id', $category->getKey())->where('version', $version)->first() ?? new ModCategorySchemaVersion;
            $row->forceFill(['category_id' => $category->getKey(), 'version' => $version, 'schema' => $schema, 'staff_id' => $staff, 'reason' => $reason, 'created_at' => $this->now->subHours($hoursAgo)])->save();
        }
    }

    private function imports(?Staff $editor, ?Staff $owner): void
    {
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $planner = app(CatalogImportPlanner::class);

        $dryRun = "\xEF\xBB\xBF".implode("\r\n", [
            'Marke;Marke slug;Land;Beliebt;Modell;Modell slug;Generation;Generation slug;Baujahr von;Baujahr bis;Aktiv',
            'Wiesmann;;DE;nein;MF5;;Roadster;;2009;2014;ja',
            'Donkervoort;;NL;nein;D8 GTO;;;;;;ja',
            'BMW;;DE;ja;M3;;E46;;2000;2006;ja',
            'BMW;;DE;ja;M3;;E92;;2007;2013;ja',
            'Honda;;JP;ja;Civic Type R;;EK9;;1997;2001;ja',
            'Honda;;JP;ja;Civic Type R;;FK8;;2017;2021;ja',
            'Porsche;;DE;ja;911;;992;;2019;;ja',
            ';;DE;;Golf;;;;;;',
            'Lotus;;GB;nein;Emira;;;;2026;2022;ja',
            'Ginetta;;UK;nein;G40;;;;;;ja',
            'Wiesmann;;DE;nein;MF5;;Roadster;;2009;2014;ja',
            'Alpina;;DE;nein;;;;;2005;;ja',
        ])."\r\n";
        $this->import(self::DRY_RUN, CatalogImportKind::Vehicles, 'katalog-ergaenzung-november.csv', $dryRun, CatalogImportStatus::Analysed, 2, $editor, null, $planner, $disk);

        $brands = "\xEF\xBB\xBF".implode("\r\n", ['Marke;Slug;Kategorie;Aliase', 'Akrapovič;;exhaust;Akra|Akrapovic', 'Remus;;exhaust;', 'ST Suspensions;;suspension;ST|ST Fahrwerke', 'Ohlins;;fahrwerk;Öhlins'])."\r\n";
        $applied = $this->import('01m66awqg0c4tr3q1mp0rt0002', CatalogImportKind::Brands, 'teilemarken-oktober.csv', $brands, CatalogImportStatus::Applied, 170, $editor, $owner, $planner, $disk);
        $applied->forceFill([
            'progress' => $applied->row_count,
            'results' => array_map(fn (array $row): array => ['line' => $row['line'], 'status' => $row['status'], 'error' => $row['error']], $applied->rows ?? []),
            'applied_by' => $editor?->getKey(),
            'reason' => 'Auspuff- und Fahrwerksmarken aus der Händlerliste ergänzt.',
            'queued_at' => $this->now->subHours(168),
            'started_at' => $this->now->subHours(168),
            'finished_at' => $this->now->subHours(168)->addMinutes(1),
        ])->save();

        $this->history('01m66awqg0c4tr3q1mp0rt0003', CatalogImportKind::Vehicles, 'modelle-japan.csv', CatalogImportStatus::Applying, 120, ['new' => 34, 'changed' => 12, 'unchanged' => 70, 'error' => 4], 40, 6, $editor);
        $this->history('01m66awqg0c4tr3q1mp0rt0004', CatalogImportKind::Vehicles, 'generationen-alt.csv', CatalogImportStatus::Failed, 18, ['new' => 6, 'changed' => 2, 'unchanged' => 10, 'error' => 0], 7, 220, $owner);
        $this->history('01m66awqg0c4tr3q1mp0rt0005', CatalogImportKind::Brands, 'marken-sommer.csv', CatalogImportStatus::Expired, 52, ['new' => 9, 'changed' => 3, 'unchanged' => 38, 'error' => 2], 0, 1100, $editor);
    }

    private function import(string $id, CatalogImportKind $kind, string $name, string $contents, CatalogImportStatus $status, int $hoursAgo, ?Staff $by, ?Staff $approver, CatalogImportPlanner $planner, Filesystem $disk): CatalogImport
    {
        $parsed = CatalogCsv::parse($contents);
        $plan = $planner->plan($kind, $parsed);
        $path = 'catalog-imports/'.$id.'.csv';
        $disk->put($path, $contents);
        $at = $this->now->subHours($hoursAgo);
        $expires = $at->addDays(30);

        $import = CatalogImport::query()->find($id) ?? new CatalogImport;
        $import->forceFill([
            'id' => $id,
            'kind' => $kind,
            'status' => $status,
            'original_name' => $name,
            'path' => $path,
            'file_hash' => hash('sha256', $contents),
            'row_count' => count($parsed['rows']),
            'counts' => $plan['counts'],
            'rows' => $plan['rows'],
            'results' => null,
            'progress' => 0,
            'reason' => null,
            'created_by' => $by?->getKey(),
            'applied_by' => null,
            'approved_by' => $approver?->getKey(),
            'approval_id' => null,
            'queued_at' => null,
            'started_at' => null,
            'finished_at' => null,
            // The dry run must stay appliable on the demo host past its 30 days from NOW: the host's clock, not the seed moment.
            'expires_at' => $expires->lessThan(SeedClock::host()) ? SeedClock::host()->addDays(30)->startOfDay() : $expires,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
        $import->timestamps = false;
        $import->save();

        return $import;
    }

    /**
     * @param  array{new: int, changed: int, unchanged: int, error: int}  $counts
     */
    private function history(string $id, CatalogImportKind $kind, string $name, CatalogImportStatus $status, int $rows, array $counts, int $progress, int $hoursAgo, ?Staff $by): void
    {
        $at = $this->now->subHours($hoursAgo);
        $import = CatalogImport::query()->find($id) ?? new CatalogImport;
        $import->forceFill([
            'id' => $id,
            'kind' => $kind,
            'status' => $status,
            'original_name' => $name,
            // No file: a resumed run of the "running" demo import can only end as failed, it never changes the catalogue.
            'path' => 'catalog-imports/'.$id.'.csv',
            'file_hash' => str_repeat('0', 64),
            'row_count' => $rows,
            'counts' => $counts,
            'rows' => [],
            'results' => [],
            'progress' => $progress,
            'reason' => $status === CatalogImportStatus::Expired ? null : 'Modellliste aus dem Händlerportal abgeglichen.',
            'created_by' => $by?->getKey(),
            'applied_by' => $status === CatalogImportStatus::Expired ? null : $by?->getKey(),
            'approved_by' => null,
            'approval_id' => null,
            'queued_at' => $status === CatalogImportStatus::Expired ? null : $at,
            'started_at' => $status === CatalogImportStatus::Expired ? null : $at,
            'finished_at' => $status === CatalogImportStatus::Failed ? $at->addMinutes(2) : null,
            // The product rule (upload + 30 days, DQ-690) while that still lies ahead of the host, as for the dry run above, so every
            // re-seed prints the same "Datei bis"; on a demo host that has passed it, the host clock keeps the import from expiring.
            'expires_at' => $status === CatalogImportStatus::Expired || ! $at->addDays(30)->lessThan(SeedClock::host()) ? $at->addDays(30) : SeedClock::host()->addDays(30)->startOfDay(),
            'created_at' => $at,
            // Host clock on purpose: the running import does not look stalled on the demo host.
            'updated_at' => $status === CatalogImportStatus::Applying ? SeedClock::host() : $at,
        ]);
        $import->timestamps = false;
        $import->save();
    }
}
