<?php

namespace App\Services\Dex;

use App\Services\Showcase\SampleContent;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * The public heat map of Entdecken › Treffen, layer "Spots" (m5.9b contract §6, owner gift detail M5.9b): city aggregates only. Counted,
 * not removed spots at least `dex.map.min_age_hours` (24) old and at most `dex.map.days` (90) old, only cities whose spots are of at
 * least `dex.map.min_cars` (5) different cars (SEC-P5G-03: a k-threshold by cars, so one car spotted five times never puts its town on
 * the map). Spots of ghost cars, of cars whose owner hides their cities and of deleted cars never count; nor do
 * samples while samples are hidden. Never a vehicle, a member or a time per car: a city, its Bundesland and a number. Night spots count
 * here (an aggregate of many cars names no single car's place). Cached `dex.map.cache_seconds` (1 h) per sample visibility.
 */
final class SpotMap
{
    public function __construct(private readonly SampleContent $samples) {}

    /**
     * @return array{generated_at: string, cities: list<array{city_id: int, name: string, bundesland: string, count: int}>}
     */
    public function get(): array
    {
        /** @var array{generated_at: string, cities: list<array{city_id: int, name: string, bundesland: string, count: int}>} */
        return Cache::remember(self::cacheKey($this->samples->visible()), config()->integer('speedclub.dex.map.cache_seconds'), fn (): array => $this->build());
    }

    public static function cacheKey(bool $samples): string
    {
        return 'dex:spot-map:'.($samples ? 'samples' : 'real');
    }

    public static function forget(): void
    {
        Cache::forget(self::cacheKey(true));
        Cache::forget(self::cacheKey(false));
    }

    /**
     * @return array{generated_at: string, cities: list<array{city_id: int, name: string, bundesland: string, count: int}>}
     */
    public function build(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $query = DB::table('spots', 's')
            ->join('vehicles as v', 'v.id', '=', 's.vehicle_id')
            ->join('de_cities as c', 'c.id', '=', 's.city_id')
            ->where('s.counted', true)
            ->whereNull('s.deleted_at')
            ->where('s.created_at', '<=', $now->subHours(config()->integer('speedclub.dex.map.min_age_hours')))
            ->where('s.created_at', '>=', $now->subDays(config()->integer('speedclub.dex.map.days')))
            ->whereNull('v.deleted_at')
            ->where('v.ghost_mode', false)
            ->where('v.hide_spot_cities', false);

        $this->samples->constrain($query, 'v.is_sample');

        $rows = $query->groupBy('c.id', 'c.name', 'c.bundesland')
            ->select(['c.id', 'c.name', 'c.bundesland'])
            ->selectRaw('COUNT(*) as spots')
            ->havingRaw('COUNT(DISTINCT s.vehicle_id) >= ?', [max(1, config()->integer('speedclub.dex.map.min_cars'))])
            ->orderByDesc('spots')
            ->orderBy('c.id')
            ->get();

        return [
            'generated_at' => $now->toIso8601String(),
            'cities' => array_values($rows->map(fn (object $row): array => [
                'city_id' => (int) $row->id,
                'name' => (string) $row->name,
                'bundesland' => (string) $row->bundesland,
                'count' => (int) $row->spots,
            ])->all()),
        ];
    }
}
