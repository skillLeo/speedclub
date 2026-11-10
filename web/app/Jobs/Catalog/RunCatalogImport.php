<?php

namespace App\Jobs\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogImportStatus;
use App\Enums\CatalogRowStatus;
use App\Models\CatalogImport;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogImportApplier;
use App\Services\Catalog\CatalogImportPlanner;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The apply of an ADM-17 import (m3.3 §2): row by row from `progress`, each planned again against the catalogue of that moment and
 * applied through the manual edit's Actions as the staff member who applied it (CatalogImportApplier), each with its own transaction and
 * audit event, so no lock outlives a row. Results per row {line, status, error} are written every SAVE_EVERY rows with the progress; after
 * TimeBudget the job queues its continuation. Idempotent: a row applied twice is unchanged the second time; a worker that died mid-run
 * is picked up again by PruneCatalogImports. One run per import at a time (cache lock). Ends `applied` with `catalog.import_finished`, or
 * `failed` when the file changed or the staff member may no longer apply.
 */
class RunCatalogImport implements ShouldQueue
{
    use Queueable;

    private const SAVE_EVERY = 25;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [30, 120];

    public function __construct(public readonly string $importId) {}

    public function handle(CatalogImportPlanner $planner, CatalogImportApplier $applier): void
    {
        $lock = Cache::lock('catalog-import:'.$this->importId, 60);

        if (! $lock->get()) {
            $this->release(30);

            return;
        }

        try {
            $this->run($planner, $applier);
        } finally {
            $lock->release();
        }
    }

    private function run(CatalogImportPlanner $planner, CatalogImportApplier $applier): void
    {
        $import = CatalogImport::query()->find($this->importId);

        if ($import === null || ! $import->status->isRunning()) {
            return;
        }

        $staff = $import->applied_by === null ? null : Staff::query()->find($import->applied_by);

        if ($staff === null || ! $staff->isActive() || ! $staff->can('catalog.import') || ! $staff->can('catalog.manage')) {
            $this->finish($import, CatalogImportStatus::Failed, 'staff_not_allowed', $staff);

            return;
        }

        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
        $contents = $disk->exists($import->path) ? (string) $disk->get($import->path) : '';

        if ($contents === '' || hash('sha256', $contents) !== $import->file_hash) {
            $this->finish($import, CatalogImportStatus::Failed, 'file_changed', $staff);

            return;
        }

        $parsed = CatalogCsv::parse($contents);
        $columns = CatalogImportPlanner::columns($import->kind, $parsed['header']);
        $dryRun = $import->rows ?? [];
        $results = $import->results ?? [];
        $progress = $import->progress;
        $reason = mb_substr('CSV-Import '.$import->original_name.': '.(string) $import->reason, 0, 1000);

        if ($import->status === CatalogImportStatus::Queued) {
            $import->forceFill(['status' => CatalogImportStatus::Applying, 'started_at' => $import->started_at ?? now()])->save();
        }

        $budget = new TimeBudget;
        $total = count($parsed['rows']);

        while ($progress < $total) {
            $row = $parsed['rows'][$progress];
            $results[] = $this->applyRow($planner, $applier, $import, $columns, $row, $dryRun[$progress] ?? null, $staff, $reason);
            $progress++;

            if ($progress % self::SAVE_EVERY === 0 || $progress === $total) {
                $import->forceFill(['progress' => $progress, 'results' => $results])->save();
            }

            if ($progress < $total && $budget->spent()) {
                $import->forceFill(['progress' => $progress, 'results' => $results])->save();
                self::dispatch($this->importId);

                return;
            }
        }

        $import->forceFill(['progress' => $progress, 'results' => $results])->save();
        $this->finish($import, CatalogImportStatus::Applied, null, $staff);
    }

    /**
     * @param  array<int, string>  $columns
     * @param  array{line: int, cells: list<string>}  $row
     * @param  array<string, mixed>|null  $planned  the dry run's row
     * @return array{line: int, status: string, error: array{code: string, params: array<string, int|string>}|null}
     */
    private function applyRow(CatalogImportPlanner $planner, CatalogImportApplier $applier, CatalogImport $import, array $columns, array $row, ?array $planned, Staff $staff, string $reason): array
    {
        // A row the dry run refused (a duplicate, say) stays refused, even if it would plan now.
        if (is_array($planned) && ($planned['status'] ?? null) === CatalogRowStatus::Error->value && is_array($planned['error'] ?? null)) {
            /** @var array{code: string, params: array<string, int|string>} $error */
            $error = $planned['error'];

            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => $error];
        }

        $now = $planner->row($import->kind, CatalogImportPlanner::values($columns, $row['cells']), $row['line']);

        if ($now['error'] !== null) {
            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => $now['error']];
        }

        try {
            $applier->apply($now, $staff, $reason);
        } catch (CatalogRefused $refused) {
            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => ['code' => $refused->reason, 'params' => ['count' => $refused->count]]];
        } catch (ValidationException $invalid) {
            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => ['code' => 'invalid', 'params' => ['field' => (string) array_key_first($invalid->errors())]]];
        } catch (AuthorizationException) {
            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => ['code' => 'forbidden', 'params' => []]];
        } catch (Throwable $failure) {
            report($failure);

            return ['line' => $row['line'], 'status' => CatalogRowStatus::Error->value, 'error' => ['code' => 'failed', 'params' => []]];
        }

        return ['line' => $row['line'], 'status' => $now['status'], 'error' => null];
    }

    private function finish(CatalogImport $import, CatalogImportStatus $status, ?string $error, ?Staff $staff): void
    {
        $counts = ['new' => 0, 'changed' => 0, 'unchanged' => 0, 'error' => 0];

        foreach ($import->results ?? [] as $result) {
            $key = is_string($result['status'] ?? null) ? $result['status'] : 'error';
            $counts[$key] = ($counts[$key] ?? 0) + 1;
        }

        DB::transaction(function () use ($import, $status, $error, $staff, $counts): void {
            $import->forceFill(['status' => $status, 'finished_at' => now()])->save();

            Audit::record(CatalogEvent::ImportFinished->value, null, after: [
                'import_id' => $import->id,
                'status' => $status->value,
                'error' => $error,
                ...$counts,
            ], actor: $staff);
        });
    }
}
