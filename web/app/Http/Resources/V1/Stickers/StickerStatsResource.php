<?php

namespace App\Http\Resources\V1\Stickers;

use App\Services\Notifications\QrMilestones;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * STK-04 scan statistics: counts only. Nothing about who scanned, from where or with what is stored, so nothing of it can appear here.
 *
 * @property array{days: list<array{date: string, count: int}>, total: int, total_30_days: int, this_week: int, last_week: int, first_scan_on: string|null, sources: array{sticker_scan: int, link: int|null}} $resource
 */
class StickerStatsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Exactly 30 entries, oldest first; `date` is YYYY-MM-DD in German time.
             *
             * @var list<array{date: string, count: int}>
             */
            'days' => $this->resource['days'],
            /** Since the car's first code, over all its codes. */
            'total' => $this->resource['total'],
            /** The sum of `days`. */
            'total_30_days' => $this->resource['total_30_days'],
            /** Monday until now, German time. */
            'this_week' => $this->resource['this_week'],
            /** The whole previous Monday–Sunday. */
            'last_week' => $this->resource['last_week'],
            /**
             * The first day with a scan, YYYY-MM-DD; null before the first.
             *
             * @var string|null
             */
            'first_scan_on' => $this->resource['first_scan_on'],
            /**
             * The last 30 days by source. `link` (visits through a shared link) is null until the views of M5.7 count it.
             *
             * @var array{sticker_scan: int, link: int|null}
             */
            'sources' => $this->resource['sources'],
            /**
             * The milestones the total has reached, of 10, 50, 100, 500, 1000.
             *
             * @var list<int>
             */
            'milestones_reached' => QrMilestones::reached($this->resource['total']),
        ];
    }
}
