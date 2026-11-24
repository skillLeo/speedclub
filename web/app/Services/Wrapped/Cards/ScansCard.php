<?php

namespace App\Services\Wrapped\Cards;

use App\Models\Vehicle;
use App\Services\Wrapped\WrappedContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Card 3: scans the member's stickers received in the season (contract §3). `sticker_scans` = web scans of the cars' codes
 * (qr_scan_daily, every code a car ever had) plus counted in-app spots of the cars (STREET DEX scans the same sticker). Never who
 * scanned. `top_city` = the city with the most day spots of the member's cars (night spots never name a city; a car whose owner hides
 * its cities names none). `profile_or_vehicle_views` stays null: there is no source of page views yet (M5.7 insights).
 */
final class ScansCard implements WrappedCard
{
    public function kind(): string
    {
        return 'scans';
    }

    public function build(WrappedContext $context): ?array
    {
        $cars = $context->carIds();

        if ($cars === []) {
            return null;
        }

        $web = (int) DB::table('qr_scan_daily as d')
            ->join('qr_codes as q', 'q.id', '=', 'd.qr_code_id')
            ->whereIn('q.vehicle_id', $cars)
            ->where('d.day', '>=', $context->season->fromDate())
            ->where('d.day', '<=', $context->season->toDate())
            ->sum('d.count');
        $spots = (int) $this->spots($context, $cars)->count();
        $total = $web + $spots;

        if ($total === 0) {
            return null;
        }

        $hiding = $context->cars->filter(fn (Vehicle $car): bool => $car->hide_spot_cities)->pluck('id')->all();
        $city = $this->spots($context, array_values(array_diff($cars, $hiding)))
            ->join('de_cities as c', 'c.id', '=', 's.city_id')
            ->where('s.is_night', false)
            ->groupBy('c.id', 'c.name')
            ->orderByRaw('COUNT(*) DESC')
            ->orderBy('c.name')
            ->value('c.name');

        return [
            'kind' => 'scans',
            'sticker_scans' => $total,
            'profile_or_vehicle_views' => null,
            'top_city' => is_string($city) ? $city : null,
        ];
    }

    /**
     * @param  list<string>  $cars
     */
    private function spots(WrappedContext $context, array $cars): Builder
    {
        return DB::table('spots as s')
            ->whereIn('s.vehicle_id', $cars === [] ? [''] : $cars)
            ->where('s.counted', true)
            ->whereNull('s.deleted_at')
            ->where('s.created_at', '>=', $context->season->fromUtc())
            ->where('s.created_at', '<=', $context->untilUtc());
    }
}
