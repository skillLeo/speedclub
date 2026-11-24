<?php

namespace App\Http\Resources\V1\Insights;

use App\Http\Resources\V1\VehicleRefResource;
use App\Models\Vehicle;
use App\Services\Insights\Insights;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * INS-01 "Statistiken" (10 §6.1, m5.7-contract §3.2), owner-only. Sums only: no viewer, name, hash, city or time of a single view.
 *
 * @phpstan-import-type Report from Insights
 *
 * @property Report $resource
 */
class InsightsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $report = $this->resource;

        return [
            /** `account` (GET me/insights: the profile and every car) or `vehicle` (GET vehicles/{id}/insights). */
            'scope' => $report['scope'],
            /** The car of the vehicle scope (VehicleRefResource); null for the account. */
            'vehicle' => $report['vehicle'] instanceof Vehicle ? new VehicleRefResource($report['vehicle']) : null,
            /** When the numbers were read (Europe/Berlin). */
            'as_of' => $report['as_of'],
            /**
             * @var string|null The first day with counting for this scope (Y-m-d); null before any view was counted. "Zählung seit …" when
             *                  it falls inside the 30 days.
             */
            'counting_since' => $report['counting_since'],
            /** Plain-language sentence in the reader's language, e.g. "Dein E46 wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche." */
            'headline' => $report['headline'],
            /**
             * Views of the last 7 Berlin days (incl. today) and the 7 before. `delta_percent` is null while the previous week had fewer than
             * 5 views; `trend` up|down|same|new ("new": nothing the week before).
             *
             * @var array{this_week: int, last_week: int, delta_percent: int|null, trend: string, total_30_days: int}
             */
            'views' => $report['views'],
            /**
             * Exactly 30 days, oldest first, zeros included: unique viewers and raw sticker scans per day.
             *
             * @var list<array{date: string, views: int, scans: int}>
             */
            'days' => $report['days'],
            /**
             * All four sources over the 30 days, most views first; `percent` (floor) null without views.
             *
             * @var list<array{source: string, label: string, views: int, percent: int|null}>
             */
            'sources' => $report['sources'],
            /**
             * Raw scans of the scope's stickers (as STK-04); null when no car of the scope ever had a sticker.
             *
             * @var array{this_week: int, last_week: int, total_30_days: int, total: int}|null
             */
            'sticker_scans' => $report['sticker_scans'],
            /**
             * Counted STREET DEX spots of the scope's cars.
             *
             * @var array{this_week: int, last_week: int}
             */
            'spots' => $report['spots'],
            /**
             * New followers that still follow: of the member (account scope only, else null) and of the cars.
             *
             * @var array{profile: array{this_week: int, last_week: int}|null, vehicles: array{this_week: int, last_week: int}}
             */
            'follows' => $report['follows'],
            /** @var array{this_week: int, last_week: int} Saves of the scope's cars (still saved). */
            'saves' => $report['saves'],
            /**
             * The private reactions on the scope's cars and their build updates; `by_type` this week, all four types, most first.
             *
             * @var array{this_week: int, last_week: int, by_type: list<array{type: string, label: string, count: int}>}
             */
            'reactions' => $report['reactions'],
            /**
             * Account scope only (else []): the profile and every published car with its views of the last 7 days.
             *
             * @var list<array{subject: string, vehicle: VehicleRefResource|null, views_this_week: int}>
             */
            'breakdown' => array_map(fn (array $row): array => [
                'subject' => $row['subject'],
                'vehicle' => $row['vehicle'] instanceof Vehicle ? new VehicleRefResource($row['vehicle']) : null,
                'views_this_week' => $row['views_this_week'],
            ], $report['breakdown']),
        ];
    }
}
