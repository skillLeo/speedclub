<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use App\Models\CatalogImport;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogImportPlanner;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * ADM-17 upload and dry run (`catalog.import`): parses the CSV (CatalogCsv), plans every row (CatalogImportPlanner) and keeps file and
 * diff, without changing the catalogue. The file goes to the private disk for RETENTION_DAYS (PruneCatalogImports). A file that cannot be
 * read at all (encoding, header, size, more than 5,000 rows) is a ValidationException on `file`; single bad rows are rows with status
 * error. Audited as `catalog.import_analysed` (counts, no content).
 */
class AnalyseCatalogImport
{
    public const RETENTION_DAYS = 30;

    public const DIRECTORY = 'catalog-imports';

    public function __construct(private readonly CatalogImportPlanner $planner) {}

    /**
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, CatalogImportKind $kind, string $contents, string $originalName): CatalogImport
    {
        StaffAtoms::ensure($staff, 'catalog.import');

        $parsed = CatalogCsv::parse($contents);
        $plan = $this->planner->plan($kind, $parsed);
        $id = (string) Str::ulid();
        $path = self::DIRECTORY.'/'.$id.'.csv';
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $disk->put($path, $contents);

        try {
            return DB::transaction(function () use ($staff, $kind, $contents, $originalName, $plan, $parsed, $id, $path): CatalogImport {
                $import = new CatalogImport;
                $import->forceFill([
                    'id' => $id,
                    'kind' => $kind,
                    'status' => CatalogImportStatus::Analysed,
                    'original_name' => mb_substr(basename(str_replace('\\', '/', $originalName)), 0, 255),
                    'path' => $path,
                    'file_hash' => hash('sha256', $contents),
                    'row_count' => count($parsed['rows']),
                    'counts' => $plan['counts'],
                    'rows' => $plan['rows'],
                    'created_by' => $staff->getKey(),
                    'expires_at' => now()->addDays(self::RETENTION_DAYS),
                ])->save();

                Audit::record(CatalogEvent::ImportAnalysed->value, null, after: [
                    'import_id' => $id,
                    'kind' => $kind->value,
                    'rows' => count($parsed['rows']),
                    ...$plan['counts'],
                ], actor: $staff);

                return $import;
            });
        } catch (\Throwable $failure) {
            $disk->delete($path);

            throw $failure;
        }
    }
}
