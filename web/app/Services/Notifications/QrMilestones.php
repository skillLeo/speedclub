<?php

namespace App\Services\Notifications;

use App\Enums\VehicleStatus;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * [SIG sig.qr_stats] The scan milestones of 02_PRODUCT_SPEC §7 (M2.7): when the stickers of a published vehicle reached 10, 50, 100, 500
 * or 1000 scans in total (all its codes, as QR-02 counts), its owner gets the in-app `qr_milestone` row once, through the Notifier (push
 * only when switched on, off by default). Run daily from the counts of qr_scan_daily (qr:milestones).
 *
 * Once per milestone: vehicles.qr_milestone holds the highest one told, claimed by a conditional update before the row is written, so a
 * second run, a parallel one or a pruned notification never tells it again. A vehicle that passed several milestones since the last run
 * hears only of the highest. Bounded by time; what is left waits for the next day.
 */
final class QrMilestones
{
    /** Ascending. */
    public const MILESTONES = [10, 50, 100, 500, 1000];

    private const MAX_SECONDS = 40;

    public function __construct(
        private readonly FeatureFlags $flags,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return list<int> every milestone a total has reached, ascending
     */
    public static function reached(int $total): array
    {
        return array_values(array_filter(self::MILESTONES, fn (int $milestone): bool => $total >= $milestone));
    }

    /**
     * @return int|null how many owners were told, null while the flag is off
     */
    public function run(): ?int
    {
        if (! $this->flags->enabled('sig.qr_stats')) {
            return null;
        }

        $started = microtime(true);
        $told = 0;
        $rows = DB::table('qr_scan_daily', 'd')
            ->join('qr_codes as q', 'q.id', '=', 'd.qr_code_id')
            ->join('vehicles as v', 'v.id', '=', 'q.vehicle_id')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.qr_milestone', '<', max(self::MILESTONES))
            ->groupBy('v.id', 'v.qr_milestone')
            ->select('v.id', 'v.qr_milestone')
            ->selectRaw('SUM(d.count) as total')
            // The next milestone after the one told, spelled out as in MILESTONES (a literal, no SQL built from a value).
            ->havingRaw('SUM(d.count) >= CASE WHEN v.qr_milestone < 10 THEN 10 WHEN v.qr_milestone < 50 THEN 50 WHEN v.qr_milestone < 100 THEN 100 WHEN v.qr_milestone < 500 THEN 500 WHEN v.qr_milestone < 1000 THEN 1000 ELSE NULL END')
            ->orderBy('v.id')
            ->get();

        foreach ($rows as $row) {
            if (microtime(true) - $started > self::MAX_SECONDS) {
                break;
            }

            $reached = self::reached((int) $row->total);
            $milestone = (int) end($reached);

            try {
                if ($this->tell((string) $row->id, $milestone)) {
                    $told++;
                }
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $told;
    }

    private function tell(string $vehicleId, int $milestone): bool
    {
        $claimed = Vehicle::query()->whereKey($vehicleId)->where('qr_milestone', '<', $milestone)->toBase()->update(['qr_milestone' => $milestone]);
        $vehicle = $claimed === 1 ? Vehicle::query()->with('owner')->find($vehicleId) : null;

        if ($vehicle === null || $vehicle->owner === null) {
            return false;
        }

        return $this->notifier->qrMilestone($vehicle->owner, $vehicle, $milestone) !== null;
    }
}
