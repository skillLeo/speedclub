<?php

namespace App\Services\Qr;

use App\Enums\QrScanState;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\Vehicle;
use App\Support\KnownBots;
use App\Support\ViewAs;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * One number per code and day: no IP, no user id, no user agent (02_PRODUCT_SPEC §3.4, ADR-029). The day is the German one, so the
 * bars in QR-02 change at midnight for the people reading them.
 *
 * @phpstan-type QrStats array{days: list<array{date: string, count: int}>, total: int, total_14_days: int, total_30_days: int}
 */
class QrScans
{
    // M4.9 (09 QR-02): thirty days.
    public const STATS_DAYS = 30;

    /**
     * Never throws: a lost count must not cost a stranger the page (F4).
     */
    public function record(QrResolution $resolution, Request $request, ?User $viewer): void
    {
        try {
            // A view-as request (M3.2) is staff looking, not a scan.
            if ($resolution->qr !== null && ViewAs::tokenOf($request) === null && $this->counts($resolution, $request, $viewer)) {
                $this->increment($resolution->qr);
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    /**
     * Thirty days, oldest first, also those without a scan, over all codes the vehicle ever had: replacing a sticker does not
     * start the count over.
     *
     * @return QrStats
     */
    public function stats(Vehicle $vehicle): array
    {
        $today = now(config()->string('speedclub.display_timezone'))->startOfDay();
        $codes = $vehicle->qrCodes()->select('id');

        $perDay = [];
        $rows = QrScanDaily::query()
            ->whereIn('qr_code_id', $codes)
            ->where('day', '>=', $today->copy()->subDays(self::STATS_DAYS - 1)->toDateString())
            ->get();

        foreach ($rows as $row) {
            $day = (string) $row->getRawOriginal('day');
            $perDay[$day] = ($perDay[$day] ?? 0) + (int) $row->getAttribute('count');
        }

        $days = [];

        for ($ago = self::STATS_DAYS - 1; $ago >= 0; $ago--) {
            $date = $today->copy()->subDays($ago)->toDateString();
            $days[] = ['date' => $date, 'count' => $perDay[$date] ?? 0];
        }

        return [
            'days' => $days,
            'total' => (int) QrScanDaily::query()->whereIn('qr_code_id', $codes)->sum('count'),
            'total_14_days' => array_sum(array_column(array_slice($days, -14), 'count')),
            'total_30_days' => array_sum(array_column($days, 'count')),
        ];
    }

    /**
     * Atomic, so parallel scans cannot lose a count, and a first scan of the day cannot fail on the unique index.
     */
    protected function increment(QrCode $qr): void
    {
        DB::table('qr_scan_daily')->upsert(
            [[
                'qr_code_id' => $qr->getKey(),
                'day' => now(config()->string('speedclub.display_timezone'))->toDateString(),
                'count' => 1,
            ]],
            ['qr_code_id', 'day'],
            ['count' => DB::raw('`count` + 1')],
        );
    }

    /**
     * A stranger's real visit to a live sticker. Previews and prefetches do not count, and neither does a revoked code.
     */
    private function counts(QrResolution $resolution, Request $request, ?User $viewer): bool
    {
        return in_array($resolution->state, [QrScanState::Active, QrScanState::Private], true)
            && $request->isMethod('GET')
            && $resolution->vehicle?->isOwnedBy($viewer) !== true
            && ! KnownBots::matches($request->userAgent())
            && ! $this->isPrefetch($request);
    }

    private function isPrefetch(Request $request): bool
    {
        foreach (['Purpose', 'Sec-Purpose', 'X-Purpose', 'X-Moz'] as $header) {
            if (str_contains(strtolower((string) $request->header($header)), 'prefetch')) {
                return true;
            }
        }

        return false;
    }
}
