<?php

namespace App\Services\Admin\Spots;

use App\Models\Spot;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The abuse signals of ADM-62 Spots (m5.9b contract §7), computed when read, never stored, read-only:
 *
 * - burst: more than 10 spots by one spotter inside 10 minutes. A spot carries it when it lies in such a window; the badge names the
 *   largest window it is part of. Pure SQL on the (spotter_id, created_at) index.
 * - device: the spotter shares an app install with another spotting account (SharedDevices; waits for a member-free install key).
 * - hop: two spots by one spotter in cities more than 300 km apart within one hour, by the city centroids of the public reference file
 *   (CityCentroids). Candidate pairs come from SQL (same spotter, ±1 h, two different known cities), the distance is checked here,
 *   streamed in chunks of 500 rows so a long history never sits in memory at once.
 *
 * Removed spots count as evidence: a spotter's burst stays a burst after staff removed part of it. Only city names and whole kilometres
 * leave this class, never a coordinate.
 */
final class SpotSignals
{
    public const BURST_MORE_THAN = 10;

    public const BURST_SECONDS = 600;

    public const HOP_KM = 300;

    public const HOP_SECONDS = 3600;

    public const SIGNALS = ['burst', 'device', 'hop'];

    private const CHUNK = 500;

    public function __construct(private readonly SharedDevices $devices) {}

    public function devicesAvailable(): bool
    {
        return $this->devices->available();
    }

    /**
     * Restricts an Eloquent spots query to the spots with a signal: `any` or one of SIGNALS. $from/$to (UTC) narrow the scans to the
     * listed period (with the signal's own window around it).
     *
     * @param  EloquentBuilder<Model>  $query
     */
    public function constrain(EloquentBuilder $query, string $signal, ?CarbonInterface $from = null, ?CarbonInterface $to = null): void
    {
        $wanted = $signal === 'any' ? self::SIGNALS : (in_array($signal, self::SIGNALS, true) ? [$signal] : []);

        if ($wanted === []) {
            return;
        }

        $burst = in_array('burst', $wanted, true) ? $this->burstSpotIds(null, $from, $to) : null;
        $hop = in_array('hop', $wanted, true) ? $this->hopSpotIds($from, $to) : null;
        $device = in_array('device', $wanted, true) ? array_keys($this->devices->spotters()) : null;

        $query->where(function (EloquentBuilder $any) use ($burst, $hop, $device): void {
            // A false clause first, so an empty signal list matches nothing instead of everything.
            $any->whereRaw('1 = 0');

            if ($burst !== null) {
                $any->orWhereIn('spots.id', $burst);
            }
            if ($hop !== null && $hop !== []) {
                $any->orWhereIn('spots.id', $hop);
            }
            if ($device !== null && $device !== []) {
                $any->orWhereIn('spots.spotter_id', $device);
            }
        });
    }

    /**
     * The signals of a page of spots, by spot id.
     *
     * @param  list<Spot>  $spots
     * @return array<string, array{burst: array{spots: int}|null, device: array{accounts: int}|null, hop: array{city: string|null, minutes: int, km: int}|null}>
     */
    public function forSpots(array $spots): array
    {
        if ($spots === []) {
            return [];
        }

        $ids = array_map(fn (Spot $spot): string => $spot->id, $spots);
        $spotters = array_values(array_unique(array_map(fn (Spot $spot): string => $spot->spotter_id, $spots)));
        $times = array_filter(array_map(fn (Spot $spot): ?Carbon => $spot->created_at, $spots));
        $from = $times === [] ? null : min($times);
        $to = $times === [] ? null : max($times);

        $bursts = [];
        foreach ($this->burstSpotIds($spotters, $from, $to)->whereIn('x.id', $ids)->groupBy('x.id')->select('x.id')->selectRaw('MAX(b.spots) as spots')->get() as $row) {
            $bursts[(string) $row->id] = (int) $row->spots;
        }

        $devices = $this->devices->spotters($spotters);
        $hops = $this->hopsOf($ids);

        $signals = [];
        foreach ($spots as $spot) {
            $signals[$spot->id] = [
                'burst' => isset($bursts[$spot->id]) ? ['spots' => $bursts[$spot->id]] : null,
                'device' => isset($devices[$spot->spotter_id]) ? ['accounts' => $devices[$spot->spotter_id]] : null,
                'hop' => $hops[$spot->id] ?? null,
            ];
        }

        return $signals;
    }

    /**
     * Spots (ids) that lie inside a burst window: `x.id` of a query on `spots as x` joined to the window ends `b` (b.spots = the window's
     * count). Optionally only for some spotters and around a period.
     *
     * @param  list<string>|null  $spotters
     */
    public function burstSpotIds(?array $spotters = null, ?CarbonInterface $from = null, ?CarbonInterface $to = null): Builder
    {
        $seconds = self::BURST_SECONDS;

        return DB::table('spots as x')
            ->joinSub($this->burstEnds($spotters, $from, $to), 'b', 'b.spotter_id', '=', 'x.spotter_id')
            ->whereRaw("x.created_at BETWEEN DATE_SUB(b.created_at, INTERVAL $seconds SECOND) AND b.created_at")
            ->when($spotters !== null, fn (Builder $q) => $q->whereIn('x.spotter_id', $spotters ?? []))
            ->select('x.id')
            ->distinct();
    }

    /**
     * Spot ids with an impossible city hop, scanned in chunks (optionally only spots inside a period, with an hour on either side).
     *
     * @return list<string>
     */
    public function hopSpotIds(?CarbonInterface $from = null, ?CarbonInterface $to = null): array
    {
        $ids = [];

        foreach ($this->hopPairs($from, $to)->lazy(self::CHUNK) as $pair) {
            if ($this->far((int) $pair->a_city, (int) $pair->b_city) !== null) {
                $ids[(string) $pair->a_id] = true;
                $ids[(string) $pair->b_id] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * Window ends: a spot whose 10 minutes up to and including it hold more than 10 spots of its spotter (removed ones included).
     *
     * @param  list<string>|null  $spotters
     */
    private function burstEnds(?array $spotters, ?CarbonInterface $from, ?CarbonInterface $to): Builder
    {
        $seconds = self::BURST_SECONDS;

        return DB::table('spots as e')
            ->join('spots as p', 'p.spotter_id', '=', 'e.spotter_id')
            ->whereRaw("p.created_at BETWEEN DATE_SUB(e.created_at, INTERVAL $seconds SECOND) AND e.created_at")
            ->when($spotters !== null, fn (Builder $q) => $q->whereIn('e.spotter_id', $spotters ?? []))
            ->when(self::utc($from), fn (Builder $q, Carbon $at) => $q->where('e.created_at', '>=', $at))
            // A window that ends up to 10 minutes after the period still holds spots of it.
            ->when(self::utc($to)?->addSeconds($seconds), fn (Builder $q, Carbon $at) => $q->where('e.created_at', '<=', $at))
            ->groupBy('e.id', 'e.spotter_id', 'e.created_at')
            ->havingRaw('COUNT(*) > ?', [self::BURST_MORE_THAN])
            ->select(['e.id', 'e.spotter_id', 'e.created_at'])
            ->selectRaw('COUNT(*) as spots');
    }

    /**
     * Pairs of one spotter's spots in two different known cities at most an hour apart, each unordered pair once (a.city < b.city).
     */
    private function hopPairs(?CarbonInterface $from, ?CarbonInterface $to): Builder
    {
        $seconds = self::HOP_SECONDS;

        return DB::table('spots as a')
            ->join('spots as b', 'b.spotter_id', '=', 'a.spotter_id')
            ->whereNotNull('a.city_id')
            ->whereNotNull('b.city_id')
            ->whereColumn('a.city_id', '<', 'b.city_id')
            ->whereRaw("b.created_at BETWEEN DATE_SUB(a.created_at, INTERVAL $seconds SECOND) AND DATE_ADD(a.created_at, INTERVAL $seconds SECOND)")
            ->when(self::utc($from)?->subSeconds($seconds), fn (Builder $q, Carbon $at) => $q->where('a.created_at', '>=', $at))
            ->when(self::utc($to)?->addSeconds($seconds), fn (Builder $q, Carbon $at) => $q->where('a.created_at', '<=', $at))
            ->select(['a.id as a_id', 'b.id as b_id', 'a.city_id as a_city', 'b.city_id as b_city', 'a.created_at as a_at', 'b.created_at as b_at'])
            ->orderBy('a.id')
            ->orderBy('b.id');
    }

    /**
     * The farthest hop of each of these spots: the other spot's city, minutes between them, whole kilometres.
     *
     * @param  list<string>  $ids
     * @return array<string, array{city: string|null, minutes: int, km: int}>
     */
    private function hopsOf(array $ids): array
    {
        $seconds = self::HOP_SECONDS;
        $pairs = DB::table('spots as a')
            ->join('spots as b', 'b.spotter_id', '=', 'a.spotter_id')
            ->whereIn('a.id', $ids)
            ->whereNotNull('a.city_id')
            ->whereNotNull('b.city_id')
            ->whereColumn('a.city_id', '<>', 'b.city_id')
            ->whereRaw("b.created_at BETWEEN DATE_SUB(a.created_at, INTERVAL $seconds SECOND) AND DATE_ADD(a.created_at, INTERVAL $seconds SECOND)")
            ->leftJoin('de_cities as c', 'c.id', '=', 'b.city_id')
            ->select(['a.id', 'a.city_id as a_city', 'b.city_id as b_city', 'a.created_at as a_at', 'b.created_at as b_at', 'c.name as b_name'])
            ->get();

        $hops = [];
        foreach ($pairs as $pair) {
            $km = $this->far((int) $pair->a_city, (int) $pair->b_city);

            if ($km === null || (isset($hops[(string) $pair->id]) && $hops[(string) $pair->id]['km'] >= $km)) {
                continue;
            }

            $minutes = (int) round(abs(Carbon::parse((string) $pair->a_at, 'UTC')->diffInSeconds(Carbon::parse((string) $pair->b_at, 'UTC'))) / 60);
            $hops[(string) $pair->id] = ['city' => is_string($pair->b_name) ? $pair->b_name : null, 'minutes' => $minutes, 'km' => $km];
        }

        return $hops;
    }

    private static function utc(?CarbonInterface $at): ?Carbon
    {
        return $at === null ? null : Carbon::instance($at)->utc();
    }

    /** Whole kilometres when the two cities are farther apart than HOP_KM, else null. */
    private function far(int $a, int $b): ?int
    {
        $km = CityCentroids::km($a, $b);

        return $km !== null && $km > self::HOP_KM ? (int) round($km) : null;
    }
}
