<?php

namespace App\Console\Commands;

use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

#[Signature('exports:prune')]
#[Description('Delete data export files after their 7 days (SET-12), fail stuck exports and drop old rows')]
class PruneDataExportsCommand extends Command
{
    private const BATCH = 500;

    /**
     * Files in exports/ that no live export owns: a job that raced the hard delete or a pruned row (review should-fix 3). A file of a
     * queued, running or ready export stays; one of an expired or failed export, or of no row at all, goes.
     */
    private function sweepOrphans(): int
    {
        $disk = Storage::disk('local');
        $removed = 0;

        foreach ($disk->files(config()->string('speedclub.data_export.directory')) as $file) {
            if (preg_match('/([0-9a-z]{26})\.zip(\.entries\.json)?\z/i', $file, $match) !== 1) {
                continue;
            }

            $live = DataExport::query()
                ->whereKey(strtolower($match[1]))
                ->whereIn('status', [DataExportStatus::Queued, DataExportStatus::Running, DataExportStatus::Ready])
                ->exists();

            if (! $live && $disk->delete($file)) {
                $removed++;
            }
        }

        return $removed;
    }

    public function handle(): int
    {
        $expired = DataExport::query()
            ->where('status', DataExportStatus::Ready)
            ->where('expires_at', '<=', now())
            ->limit(self::BATCH)
            ->get();

        foreach ($expired as $export) {
            BuildDataExport::deleteFiles($export);
            $export->forceFill(['status' => DataExportStatus::Expired, 'path' => null])->save();
        }

        $stuck = DataExport::query()
            ->whereIn('status', [DataExportStatus::Queued, DataExportStatus::Running])
            ->where('requested_at', '<', now()->subHours(config()->integer('speedclub.data_export.stuck_after_hours')))
            ->limit(self::BATCH)
            ->get();

        foreach ($stuck as $export) {
            BuildDataExport::deleteFiles($export);
            $export->forceFill(['status' => DataExportStatus::Failed, 'failed_at' => now(), 'path' => null, 'progress' => null])->save();
        }

        $old = DataExport::query()
            ->whereIn('status', [DataExportStatus::Expired, DataExportStatus::Failed])
            ->where('requested_at', '<', now()->subDays(config()->integer('speedclub.data_export.keep_rows_days')))
            ->limit(self::BATCH)
            ->get();

        foreach ($old as $export) {
            BuildDataExport::deleteFiles($export);
            $export->delete();
        }

        $orphans = $this->sweepOrphans();

        $this->info("Expired {$expired->count()}, failed {$stuck->count()} stuck and removed {$old->count()} old data exports, {$orphans} orphan files.");

        return self::SUCCESS;
    }
}
