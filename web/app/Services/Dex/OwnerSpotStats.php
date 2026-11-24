<?php

namespace App\Services\Dex;

use App\Http\Resources\V1\SpotCardResource;
use App\Models\Block;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * DEX-06 / INS-01 (m5.9b contract §4): the owner's spot numbers of one car. Counted spots only. Cities come from day spots only (a night
 * spot never names its city for a single car) and not at all while the owner hides them; a spotter is named only while they keep "Meine
 * Spots zeigen" on, is publicly visible and has no block with the owner, otherwise the owner reads "jemand" ({anonymous: true}).
 */
final class OwnerSpotStats
{
    public function __construct(private readonly SpotStats $stats) {}

    /**
     * @return array{total: int, unique_spotters: int, cities_count: int, cities: list<array{name: string, count: int}>, last_30_days: list<array{day: string, count: int}>, recent_spotters: list<array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|array{anonymous: true}>, street_famous: array{tier: int|null}}
     */
    public function for(Vehicle $vehicle): array
    {
        $stat = VehicleSpotStat::query()->find($vehicle->id) ?? $this->stats->recompute($vehicle->id);
        $hide = $vehicle->hide_spot_cities;

        return [
            'total' => $stat->total,
            'unique_spotters' => $stat->unique_spotters,
            'cities_count' => $hide ? 0 : $stat->cities_count,
            'cities' => $hide ? [] : $this->cities($vehicle),
            'last_30_days' => $this->days($vehicle),
            'recent_spotters' => $this->spotters($vehicle),
            'street_famous' => ['tier' => $stat->street_famous_tier],
        ];
    }

    /**
     * @return list<array{name: string, count: int}>
     */
    private function cities(Vehicle $vehicle): array
    {
        return array_values(DB::table('spots as s')
            ->join('de_cities as c', 'c.id', '=', 's.city_id')
            ->where('s.vehicle_id', $vehicle->id)->where('s.counted', true)->where('s.is_night', false)->whereNull('s.deleted_at')
            ->groupBy('c.id', 'c.name')
            ->select('c.name')->selectRaw('COUNT(*) as spots')
            ->orderByDesc('spots')->orderBy('c.name')
            ->limit(20)
            ->get()
            ->map(fn (object $row): array => ['name' => (string) $row->name, 'count' => (int) $row->spots])
            ->all());
    }

    /**
     * Every day of the last `dex.stats_days` (Europe/Berlin), oldest first, zeros included.
     *
     * @return list<array{day: string, count: int}>
     */
    private function days(Vehicle $vehicle): array
    {
        $zone = config()->string('speedclub.display_timezone');
        $days = max(1, config()->integer('speedclub.dex.stats_days'));
        $first = CarbonImmutable::now($zone)->startOfDay()->subDays($days - 1);
        $counts = [];

        Spot::query()->where('vehicle_id', $vehicle->id)->where('counted', true)->where('created_at', '>=', $first->utc())
            ->where('created_at', '<', self::cutoff())
            ->select(['id', 'created_at'])->orderBy('id')
            ->each(function (Spot $spot) use (&$counts, $zone): void {
                $day = $spot->created_at?->copy()->setTimezone($zone)->format('Y-m-d');

                if ($day !== null) {
                    $counts[$day] = ($counts[$day] ?? 0) + 1;
                }
            });

        $series = [];

        for ($i = 0; $i < $days; $i++) {
            $day = $first->addDays($i)->format('Y-m-d');
            $series[] = ['day' => $day, 'count' => $counts[$day] ?? 0];
        }

        return $series;
    }

    /**
     * Spots from this moment on are too fresh for anything that tells the owner when or by whom (UTC, as created_at is stored).
     */
    public static function cutoff(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->subHours(max(1, config()->integer('speedclub.dex.alerts.window_hours')));
    }

    /**
     * The latest distinct spotters, newest first (older than the alert window).
     *
     * @return list<array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|array{anonymous: true}>
     */
    private function spotters(Vehicle $vehicle): array
    {
        $rows = DB::table('spots')
            ->where('vehicle_id', $vehicle->id)->where('counted', true)->whereNull('deleted_at')
            ->where('created_at', '<', self::cutoff())
            ->groupBy('spotter_id')
            ->select('spotter_id')->selectRaw('MAX(id) as last_id')
            ->orderByDesc('last_id')
            ->limit(max(1, config()->integer('speedclub.dex.recent_spotters')))
            ->get();
        $ids = array_values($rows->map(fn (object $row): string => (string) $row->spotter_id)->all());
        $members = User::query()->whereKey($ids)->with('avatar')->get()->keyBy('id');
        $blocked = array_flip(array_merge(
            Block::query()->where('blocker_id', $vehicle->owner_id)->whereIn('blocked_id', $ids)->pluck('blocked_id')->map(strval(...))->all(),
            Block::query()->where('blocked_id', $vehicle->owner_id)->whereIn('blocker_id', $ids)->pluck('blocker_id')->map(strval(...))->all(),
        ));
        $list = [];

        foreach ($ids as $id) {
            $member = $members->get($id);

            if (! $member instanceof User || isset($blocked[$id]) || $member->getAttribute('show_my_spots') === false || ! $member->isPubliclyVisible() || $member->username === null) {
                $list[] = ['anonymous' => true];

                continue;
            }

            $list[] = [
                'username' => $member->username,
                'display_name' => $member->getAttribute('display_name'),
                'avatar' => SpotCardResource::avatar($member->avatar),
            ];
        }

        return $list;
    }
}
