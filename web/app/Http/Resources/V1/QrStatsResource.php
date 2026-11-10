<?php

namespace App\Http\Resources\V1;

use App\Services\Notifications\QrMilestones;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * [SIG] Scans of QR-02. Counts only: nothing about who.
 *
 * @property array{days: list<array{date: string, count: int}>, total: int, total_14_days: int} $resource
 */
class QrStatsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Exactly 14 entries, oldest first. `date` is YYYY-MM-DD in German time.
             *
             * @var list<array{date: string, count: int}>
             */
            'days' => $this->resource['days'],
            /**
             * Since the vehicle's first code, over all its codes.
             *
             * @var int
             */
            'total' => $this->resource['total'],
            /** @var int */
            'total_14_days' => $this->resource['total_14_days'],
            /**
             * The milestones of the in-app `qr_milestone` notification the total has reached, ascending: of 10, 50, 100, 500, 1000.
             *
             * @var list<int>
             */
            'milestones_reached' => QrMilestones::reached($this->resource['total']),
        ];
    }
}
