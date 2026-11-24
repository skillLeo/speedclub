<?php

namespace App\Services\Stickers;

use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Vehicle;
use App\Services\Qr\QrScans;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * STK-04 and the hub's "Scans diese Woche" (m5.4-contract §5): sums of qr_scan_daily, one number per code and German day, over every
 * code the car ever had. Nothing about who scanned exists to be read (ADR-029). Weeks run Monday to Sunday in German time.
 *
 * @phpstan-type StickerStatsData array{days: list<array{date: string, count: int}>, total: int, total_30_days: int, this_week: int, last_week: int, first_scan_on: string|null, sources: array{sticker_scan: int, link: int|null}}
 */
final class StickerStats
{
    public function __construct(private readonly QrScans $scans) {}

    /**
     * The 30 days and the weeks count from $now (the QA clock outside production, DQ-P5-201); null is the real now.
     *
     * @return StickerStatsData
     */
    public function forVehicle(Vehicle $vehicle, ?CarbonImmutable $now = null): array
    {
        $base = $this->scans->stats($vehicle, $now);
        $codes = $vehicle->qrCodes()->select('id');
        [$thisWeek, $lastWeek] = $this->weeks($now);

        $first = QrScanDaily::query()->whereIn('qr_code_id', $codes)->where('count', '>', 0)->min('day');

        return [
            'days' => $base['days'],
            'total' => $base['total'],
            'total_30_days' => $base['total_30_days'],
            // Under the QA clock the week also ends on its day, so scans after that moment do not count; the real clock has none.
            'this_week' => $this->sum($vehicle, $thisWeek, $now === null ? null : $now->setTimezone(config()->string('speedclub.display_timezone'))),
            'last_week' => $this->sum($vehicle, $lastWeek, $thisWeek->subDay()),
            'first_scan_on' => is_string($first) ? substr($first, 0, 10) : null,
            // `link` (visits through a shared link) is counted by the views of M5.7; until then nothing says how many there were.
            'sources' => ['sticker_scan' => $base['total_30_days'], 'link' => null],
        ];
    }

    /**
     * Scans since Monday per vehicle id, for a page of hub cards, in one query.
     *
     * @param  list<string>  $vehicleIds
     * @return array<string, int>
     */
    public function thisWeek(array $vehicleIds): array
    {
        if ($vehicleIds === []) {
            return [];
        }

        [$monday] = $this->weeks();

        return DB::table('qr_scan_daily')
            ->join('qr_codes', 'qr_codes.id', '=', 'qr_scan_daily.qr_code_id')
            ->whereIn('qr_codes.vehicle_id', $vehicleIds)
            ->where('qr_scan_daily.day', '>=', $monday->toDateString())
            ->groupBy('qr_codes.vehicle_id')
            ->selectRaw('qr_codes.vehicle_id as vehicle_id, SUM(qr_scan_daily.count) as scans')
            ->get()
            ->mapWithKeys(fn (object $row): array => [(string) $row->vehicle_id => (int) $row->scans])
            ->all();
    }

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable} this Monday and last Monday, German time
     */
    private function weeks(?CarbonImmutable $now = null): array
    {
        $zone = config()->string('speedclub.display_timezone');
        $monday = ($now === null ? CarbonImmutable::now($zone) : $now->setTimezone($zone))->startOfWeek(CarbonImmutable::MONDAY)->startOfDay();

        return [$monday, $monday->subWeek()];
    }

    private function sum(Vehicle $vehicle, CarbonImmutable $from, ?CarbonImmutable $until): int
    {
        $query = QrScanDaily::query()
            ->whereIn('qr_code_id', QrCode::query()->where('vehicle_id', $vehicle->getKey())->select('id'))
            ->where('day', '>=', $from->toDateString());

        if ($until !== null) {
            $query->where('day', '<=', $until->toDateString());
        }

        return (int) $query->sum('count');
    }
}
