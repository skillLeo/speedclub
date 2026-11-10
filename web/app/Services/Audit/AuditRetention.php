<?php

namespace App\Services\Audit;

use App\Services\Privacy\RetentionPolicy;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use stdClass;

/**
 * Applies the audit retention of 06_ADMIN_SPEC §4 (ADR-113) without weakening the chain: staff access data lives outside
 * it, and old events leave it from the front only, with the hash of the last one kept as the new starting point.
 */
final class AuditRetention
{
    private const DAILY_EXPORT = '/^audit\/(\d{4}-\d{2}-\d{2})\.jsonl$/';

    private const ARCHIVE = '/^audit\/archive\/(\d{4}-\d{2}-\d{2})-\d+\.jsonl$/';

    public function purgeAccessData(): int
    {
        return DB::table('audit_event_access')
            ->where('occurred_at', '<', Carbon::now('UTC')->subMonthsNoOverflow(app(RetentionPolicy::class)->value('audit_access_months')))
            ->delete();
    }

    /**
     * Moves events past the retention period to private JSONL files, oldest first, and stops in time for the next cron
     * run. Refuses to touch a broken chain, because that would destroy the evidence.
     *
     * @return int events archived
     */
    public function archiveEvents(): int
    {
        $verification = AuditChain::verify();

        if (! $verification->intact) {
            throw new RuntimeException("Audit chain is broken at event {$verification->brokenAt}, nothing was archived.");
        }

        $cutoff = Carbon::now('UTC')->subMonthsNoOverflow(config()->integer('speedclub.audit.event_months'))->format('Y-m-d H:i:s');
        $deadline = microtime(true) + config()->integer('speedclub.audit.archive_max_seconds');
        $archived = 0;

        while (microtime(true) < $deadline) {
            $rows = DB::table('audit_events')
                ->where('occurred_at', '<', $cutoff)
                ->orderBy('id')
                ->limit(config()->integer('speedclub.audit.archive_batch'))
                ->get();

            $last = $rows->last();

            if (! $last instanceof stdClass) {
                break;
            }

            $this->writeArchive($last, $rows->map(fn (object $row): string => json_encode($row, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES))->implode("\n")."\n");
            $this->removeThrough($last);
            $archived += $rows->count();
        }

        return $archived;
    }

    /**
     * Daily exports end with the events themselves; the archive files after archive_months.
     *
     * @return int files deleted
     */
    public function purgeExports(): int
    {
        $disk = $this->disk();
        $deleted = 0;

        $limits = [
            self::DAILY_EXPORT => [$disk->files('audit'), config()->integer('speedclub.audit.event_months')],
            self::ARCHIVE => [$disk->files('audit/archive'), config()->integer('speedclub.audit.archive_months')],
        ];

        foreach ($limits as $pattern => [$files, $months]) {
            $cutoff = Carbon::now('UTC')->subMonthsNoOverflow($months)->format('Y-m-d');

            foreach ($files as $file) {
                if (preg_match($pattern, $file, $match) === 1 && $match[1] < $cutoff && $disk->delete($file)) {
                    $deleted++;
                }
            }
        }

        return $deleted;
    }

    private function writeArchive(stdClass $last, string $contents): void
    {
        $day = substr(is_string($last->occurred_at) ? $last->occurred_at : '', 0, 10);
        $id = is_numeric($last->id) ? (int) $last->id : 0;

        // The same name on a retry after a crash, so a repeated run overwrites instead of duplicating.
        if (! $this->disk()->put("audit/archive/$day-$id.jsonl", $contents)) {
            throw new RuntimeException('Could not write the audit archive, nothing was removed.');
        }
    }

    private function removeThrough(stdClass $last): void
    {
        $id = is_numeric($last->id) ? (int) $last->id : 0;

        DB::transaction(function () use ($id, $last): void {
            DB::table('audit_chain_head')->where('id', 1)->lockForUpdate()->first();
            DB::unprepared('SET '.AuditChain::ARCHIVE_VARIABLE.' = 1');

            try {
                DB::table('audit_events')->where('id', '<=', $id)->delete();
            } finally {
                DB::unprepared('SET '.AuditChain::ARCHIVE_VARIABLE.' = NULL');
            }

            DB::table('audit_chain_head')->where('id', 1)->update(['archived_through_id' => $id, 'archived_hash' => $last->hash]);
        });
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.media.private_disk'));
    }
}
