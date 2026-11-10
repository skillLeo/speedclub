<?php

namespace App\Actions\Me;

use App\Enums\DataExportStatus;
use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Exceptions\ApiException;
use App\Models\DataExport;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\Reauthentication;
use App\Services\DataExport\BuildDataExport;
use App\Support\DisplayDate;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * SET-12: one export per 24 hours (02_PRODUCT_SPEC §3.1); a failed one does not count, so the member can ask again at once. The jobs
 * start from the cron queue within the minute.
 */
class RequestDataExport
{
    public function __construct(private readonly Reauthentication $reauth) {}

    /**
     * All export files together stay under speedclub.data_export.max_total_mb (review nit 26): a wave of requests waits instead of
     * filling the host's quota. The ZIPs of 7 days, read from the disk, so half-written ones count too.
     */
    private function ensureRoom(): void
    {
        $disk = Storage::disk('local');
        $bytes = 0;

        foreach ($disk->allFiles(config()->string('speedclub.data_export.directory')) as $file) {
            $bytes += (int) $disk->size($file);
        }

        if ($bytes >= config()->integer('speedclub.data_export.max_total_mb') * 1048576) {
            throw new ApiException(ErrorCode::ServiceUnavailable, (string) __('settings.export.busy'), headers: ['Retry-After' => '3600']);
        }
    }

    public function handle(User $user, string $password): DataExport
    {
        $this->reauth->password($user, $password);

        return DB::transaction(function () use ($user): DataExport {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            $latest = $user->dataExports()
                ->whereNull('requested_by_staff_id')
                ->where('status', '!=', DataExportStatus::Failed)
                ->where('requested_at', '>', now()->subHours(config()->integer('speedclub.data_export.cooldown_hours')))
                ->latest('requested_at')
                ->first();

            if ($latest !== null && $latest->requested_at !== null) {
                $next = CarbonImmutable::instance($latest->requested_at)->addHours(config()->integer('speedclub.data_export.cooldown_hours'));

                throw new ApiException(
                    ErrorCode::RateLimited,
                    (string) __('settings.export.cooldown', ['date' => DisplayDate::format($next)]),
                    headers: ['Retry-After' => (string) max(1, (int) now()->diffInSeconds($next, true))],
                    data: ['retry_at' => $next->toIso8601String()],
                );
            }

            $this->ensureRoom();

            $export = new DataExport;
            $export->forceFill(['user_id' => $user->id, 'status' => DataExportStatus::Queued, 'requested_at' => now()])->save();

            Audit::record(MemberSecurityEvent::DataExportRequested->value, $user, actor: $user);

            BuildDataExport::dispatch($export->id)->afterCommit();

            return $export;
        });
    }
}
