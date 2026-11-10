<?php

namespace App\Jobs\Catalog;

use App\Actions\Admin\Catalog\AnalyseCatalogImport;
use App\Enums\ApprovalStatus;
use App\Enums\CatalogImportStatus;
use App\Models\ApprovalRequest;
use App\Models\CatalogImport;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Storage;

/**
 * Daily housekeeping of ADM-17 (schedule: `Schedule::job(new PruneCatalogImports)->daily()`):
 *
 * - the file of an import past its 30 days leaves the private disk; the row stays with its dry run and results (the report), as
 *   `expired` unless it was applied or failed;
 * - an apply whose worker died (queued or applying, untouched for STALE_MINUTES) gets its RunCatalogImport again, which resumes at
 *   `progress`;
 * - an import whose approval was denied, cancelled, failed or expired goes back to `analysed`, so it can be asked for again.
 *
 * Bounded per run; idempotent.
 */
class PruneCatalogImports implements ShouldQueue
{
    use Queueable;

    public const STALE_MINUTES = 10;

    private const LIMIT = 200;

    public int $timeout = 45;

    public function handle(): void
    {
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

        CatalogImport::query()->where('expires_at', '<=', now())->where('status', '!=', CatalogImportStatus::Expired)
            ->whereNotIn('status', [CatalogImportStatus::Queued, CatalogImportStatus::Applying])
            ->limit(self::LIMIT)->get()
            ->each(function (CatalogImport $import) use ($disk): void {
                $disk->delete($import->path);
                $ended = in_array($import->status, [CatalogImportStatus::Applied, CatalogImportStatus::Failed], true);
                $import->forceFill(['status' => $ended ? $import->status : CatalogImportStatus::Expired, 'expires_at' => $ended ? null : $import->expires_at])->save();
            });

        // Files without a row (an upload whose transaction never committed), after a day.
        foreach ($disk->files(AnalyseCatalogImport::DIRECTORY) as $file) {
            $id = pathinfo($file, PATHINFO_FILENAME);

            if ($disk->lastModified($file) < now()->subDay()->getTimestamp() && ! CatalogImport::query()->whereKey($id)->where('path', $file)->exists()) {
                $disk->delete($file);
            }
        }

        CatalogImport::query()->whereIn('status', [CatalogImportStatus::Queued, CatalogImportStatus::Applying])
            ->where('updated_at', '<=', now()->subMinutes(self::STALE_MINUTES))
            ->limit(self::LIMIT)->pluck('id')
            ->each(fn (string $id) => RunCatalogImport::dispatch($id));

        CatalogImport::query()->where('status', CatalogImportStatus::AwaitingApproval)
            ->whereNotIn('approval_id', ApprovalRequest::query()->where('status', ApprovalStatus::Pending)->select('id'))
            ->limit(self::LIMIT)
            ->update(['status' => CatalogImportStatus::Analysed->value, 'updated_at' => now()]);
    }
}
