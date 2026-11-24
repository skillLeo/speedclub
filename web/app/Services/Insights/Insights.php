<?php

namespace App\Services\Insights;

use App\Enums\ReactionType;
use App\Enums\VehicleStatus;
use App\Enums\ViewSource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * INS-01 "Statistiken" (10 §6.1, m5.7-contract §3.2–§3.4), owner-only: views of the last 7 Europe/Berlin days against the 7 before, a
 * 30-day series, the sources, sticker scans, spots, new followers, saves and the private reactions. Sums only: nothing here names, counts
 * or hints at a single viewer, and an unfollow or an unsave is simply not counted (no loss language).
 *
 * Account scope = the profile and every not deleted car of the member; vehicle scope = that car. A handful of grouped queries on the
 * indexed (owner_id, day) / (vehicle_id, day) and the social tables' (item, created_at) indexes.
 *
 * @phpstan-type Pair array{this_week: int, last_week: int}
 * @phpstan-type Report array{scope: string, vehicle: Vehicle|null, as_of: string, counting_since: string|null, headline: string,
 *     views: array{this_week: int, last_week: int, delta_percent: int|null, trend: string, total_30_days: int},
 *     days: list<array{date: string, views: int, scans: int}>,
 *     sources: list<array{source: string, label: string, views: int, percent: int|null}>,
 *     sticker_scans: array{this_week: int, last_week: int, total_30_days: int, total: int}|null,
 *     spots: Pair, follows: array{profile: Pair|null, vehicles: Pair}, saves: Pair,
 *     reactions: array{this_week: int, last_week: int, by_type: list<array{type: string, label: string, count: int}>},
 *     breakdown: list<array{subject: string, vehicle: Vehicle|null, views_this_week: int}>}
 */
final class Insights
{
    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @return Report
     */
    public function forAccount(User $member): array
    {
        /** @var list<Vehicle> $vehicles */
        $vehicles = Vehicle::query()->where('owner_id', $member->id)->orderBy('sort')->orderBy('created_at')->get()->all();
        $ids = array_map(fn (Vehicle $vehicle): string => $vehicle->id, $vehicles);
        $views = fn (): Builder => DB::table('view_days')->where('owner_id', $member->id)
            ->where(fn (Builder $scope) => $scope->whereNull('vehicle_id')->orWhereIn('vehicle_id', $ids));

        return $this->report('account', null, $member->created_at?->toImmutable(), $views, $ids, $member, $vehicles);
    }

    /**
     * @return Report
     */
    public function forVehicle(Vehicle $vehicle): array
    {
        $views = fn (): Builder => DB::table('view_days')->where('vehicle_id', $vehicle->id);

        return $this->report('vehicle', $vehicle, $vehicle->created_at?->toImmutable(), $views, [$vehicle->id], null, []);
    }

    /**
     * @param  callable(): Builder  $views
     * @param  list<string>  $ids
     * @param  list<Vehicle>  $vehicles
     * @return Report
     */
    private function report(string $scope, ?Vehicle $vehicle, ?CarbonImmutable $created, callable $views, array $ids, ?User $member, array $vehicles): array
    {
        $zone = config()->string('speedclub.insights.timezone');
        $now = CarbonImmutable::now($zone);
        $today = $now->startOfDay();
        $span = config()->integer('speedclub.insights.days');
        $week = config()->integer('speedclub.insights.week_days');
        $from = $today->subDays($span - 1);
        $thisFrom = $today->subDays($week - 1);
        $lastFrom = $today->subDays(2 * $week - 1);

        $perDay = $views()->where('day', '>=', $from->toDateString())->groupBy('day')->selectRaw('day, SUM(views) as total')->pluck('total', 'day')
            ->mapWithKeys(fn (mixed $total, mixed $day): array => [substr((string) $day, 0, 10) => (int) $total])->all();
        $scans = $this->scansPerDay($ids, $from);

        $days = [];

        for ($date = $from; $date->lessThanOrEqualTo($today); $date = $date->addDay()) {
            $key = $date->toDateString();
            $days[] = ['date' => $key, 'views' => $perDay[$key] ?? 0, 'scans' => $scans[$key] ?? 0];
        }

        /** @var array<string, int> $viewsByDay */
        $viewsByDay = array_column($days, 'views', 'date');
        /** @var array<string, int> $scansByDay */
        $scansByDay = array_column($days, 'scans', 'date');
        $sum = fn (CarbonImmutable $start, CarbonImmutable $end, string $field): int => array_sum(array_filter(
            $field === 'scans' ? $scansByDay : $viewsByDay,
            fn (string $date): bool => $date >= $start->toDateString() && $date <= $end->toDateString(),
            ARRAY_FILTER_USE_KEY,
        ));
        $thisWeek = $sum($thisFrom, $today, 'views');
        $lastWeek = $sum($lastFrom, $thisFrom->subDay(), 'views');
        $total30 = array_sum(array_column($days, 'views'));

        // Windows of the social tables in UTC (timestamps are stored in UTC), from the same Berlin day starts.
        $windows = [$lastFrom->utc(), $thisFrom->utc()];

        return [
            'scope' => $scope,
            'vehicle' => $vehicle,
            // The minute, not the second: the ETag stays the same while nothing changed (review NH).
            'as_of' => $now->startOfMinute()->toIso8601String(),
            'counting_since' => $this->countingSince($created),
            'headline' => $this->headline($vehicle, $thisWeek, $lastWeek),
            'views' => [
                'this_week' => $thisWeek,
                'last_week' => $lastWeek,
                'delta_percent' => $this->delta($thisWeek, $lastWeek),
                'trend' => $this->trend($thisWeek, $lastWeek),
                'total_30_days' => $total30,
            ],
            'days' => $days,
            'sources' => $this->sources($views, $from, $total30),
            'sticker_scans' => $this->stickerScans($ids, $days, $sum, $thisFrom, $lastFrom, $today),
            'spots' => $this->pair(DB::table('spots')->whereIn('vehicle_id', $ids)->where('counted', true)->whereNull('deleted_at'), $windows),
            'follows' => [
                'profile' => $member === null ? null : $this->pair(DB::table('follows')->where('followee_id', $member->id), $windows),
                'vehicles' => $this->pair(DB::table('vehicle_follows')->whereIn('vehicle_id', $ids), $windows),
            ],
            'saves' => $this->pair(DB::table('saves')->whereIn('vehicle_id', $ids), $windows),
            'reactions' => $this->reactions($ids, $windows),
            'breakdown' => $member === null ? [] : $this->breakdown($member, $vehicles, $thisFrom),
        ];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, int> Berlin day => sticker scans of the scope's codes (every code a car ever had)
     */
    private function scansPerDay(array $ids, CarbonImmutable $from): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('qr_scan_daily')
            ->whereIn('qr_code_id', DB::table('qr_codes')->whereIn('vehicle_id', $ids)->select('id'))
            ->where('day', '>=', $from->toDateString())
            ->groupBy('day')
            ->selectRaw('day, SUM(`count`) as total')
            ->pluck('total', 'day')
            ->mapWithKeys(fn (mixed $total, mixed $day): array => [substr((string) $day, 0, 10) => (int) $total])
            ->all();
    }

    /**
     * Null when none of the scope's cars ever had a sticker; the raw scans (as STK-04), not deduplicated views.
     *
     * @param  list<string>  $ids
     * @param  list<array{date: string, views: int, scans: int}>  $days
     * @param  callable(CarbonImmutable, CarbonImmutable, string): int  $sum
     * @return array{this_week: int, last_week: int, total_30_days: int, total: int}|null
     */
    private function stickerScans(array $ids, array $days, callable $sum, CarbonImmutable $thisFrom, CarbonImmutable $lastFrom, CarbonImmutable $today): ?array
    {
        if ($ids === [] || ! DB::table('qr_codes')->whereIn('vehicle_id', $ids)->exists()) {
            return null;
        }

        return [
            'this_week' => $sum($thisFrom, $today, 'scans'),
            'last_week' => $sum($lastFrom, $thisFrom->subDay(), 'scans'),
            'total_30_days' => array_sum(array_column($days, 'scans')),
            'total' => (int) DB::table('qr_scan_daily')
                ->whereIn('qr_code_id', DB::table('qr_codes')->whereIn('vehicle_id', $ids)->select('id'))
                ->sum('count'),
        ];
    }

    /**
     * All four sources, most views first (then the enum order); percent of the 30 days, null without any view.
     *
     * @param  callable(): Builder  $views
     * @return list<array{source: string, label: string, views: int, percent: int|null}>
     */
    private function sources(callable $views, CarbonImmutable $from, int $total): array
    {
        $bySource = $views()->where('day', '>=', $from->toDateString())->groupBy('source')->selectRaw('source, SUM(views) as total')
            ->pluck('total', 'source')->map(fn (mixed $value): int => (int) $value)->all();
        $order = array_flip(array_map(fn (ViewSource $source): string => $source->value, ViewSource::cases()));

        $rows = array_map(fn (ViewSource $source): array => [
            'source' => $source->value,
            'label' => $source->label(),
            'views' => $bySource[$source->value] ?? 0,
            'percent' => $total === 0 ? null : intdiv(($bySource[$source->value] ?? 0) * 100, $total),
        ], ViewSource::cases());

        usort($rows, fn (array $a, array $b): int => [$b['views'], $order[$a['source']]] <=> [$a['views'], $order[$b['source']]]);

        return $rows;
    }

    /**
     * Rows created (created_at) in the last week and in the week before (still existing ones).
     *
     * @param  array{0: CarbonImmutable, 1: CarbonImmutable}  $windows  [start of last week, start of this week], UTC
     * @return array{this_week: int, last_week: int}
     */
    private function pair(Builder $query, array $windows): array
    {
        [$lastStart, $thisStart] = $windows;
        $row = $query->where('created_at', '>=', $lastStart)
            ->selectRaw('SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) as this_week, SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) as last_week', [$thisStart, $thisStart])
            ->first();

        return ['this_week' => (int) ($row->this_week ?? 0), 'last_week' => (int) ($row->last_week ?? 0)];
    }

    /**
     * The private reactions on the scope's cars and their build updates (the owner already sees them, ADR-413).
     *
     * @param  list<string>  $ids
     * @param  array{0: CarbonImmutable, 1: CarbonImmutable}  $windows
     * @return array{this_week: int, last_week: int, by_type: list<array{type: string, label: string, count: int}>}
     */
    private function reactions(array $ids, array $windows): array
    {
        $items = fn (): Builder => DB::table('reactions')->where(fn (Builder $item) => $item
            ->where(fn (Builder $car) => $car->where('reactable_type', 'vehicle')->whereIn('reactable_id', $ids))
            ->orWhere(fn (Builder $update) => $update->where('reactable_type', 'build_update')
                ->whereIn('reactable_id', DB::table('build_updates')->whereIn('vehicle_id', $ids)->select('id'))));

        $pair = $ids === [] ? ['this_week' => 0, 'last_week' => 0] : $this->pair($items(), $windows);
        $byType = $ids === [] ? [] : $items()->where('created_at', '>=', $windows[1])->groupBy('type')->selectRaw('type, COUNT(*) as total')
            ->pluck('total', 'type')->map(fn (mixed $value): int => (int) $value)->all();
        $order = array_flip(array_map(fn (ReactionType $type): string => $type->value, ReactionType::cases()));

        $rows = array_map(fn (ReactionType $type): array => [
            'type' => $type->value,
            'label' => $type->label(),
            'count' => $byType[$type->value] ?? 0,
        ], ReactionType::cases());

        usort($rows, fn (array $a, array $b): int => [$b['count'], $order[$a['type']]] <=> [$a['count'], $order[$b['type']]]);

        return [...$pair, 'by_type' => $rows];
    }

    /**
     * The profile and each published car with its views of the last 7 days.
     *
     * @param  list<Vehicle>  $vehicles
     * @return list<array{subject: string, vehicle: Vehicle|null, views_this_week: int}>
     */
    private function breakdown(User $member, array $vehicles, CarbonImmutable $thisFrom): array
    {
        $rows = DB::table('view_days')->where('owner_id', $member->id)->where('day', '>=', $thisFrom->toDateString())
            ->groupBy('vehicle_id')->selectRaw('vehicle_id, SUM(views) as total')->get();
        $byVehicle = [];
        $profile = 0;

        foreach ($rows as $row) {
            if ($row->vehicle_id === null) {
                $profile = (int) $row->total;
            } else {
                $byVehicle[(string) $row->vehicle_id] = (int) $row->total;
            }
        }

        $list = [['subject' => 'profile', 'vehicle' => null, 'views_this_week' => $profile]];

        foreach ($vehicles as $vehicle) {
            if ($vehicle->status === VehicleStatus::Published) {
                $list[] = ['subject' => 'vehicle', 'vehicle' => $vehicle, 'views_this_week' => $byVehicle[$vehicle->id] ?? 0];
            }
        }

        return $list;
    }

    /**
     * The first day views were counted on this host, or the subject's creation day when later; null before any view was counted.
     */
    private function countingSince(?CarbonImmutable $created): ?string
    {
        $first = DB::table('view_days')->min('day');

        if ($first === null) {
            return null;
        }

        $first = substr((string) $first, 0, 10);
        $born = $created?->setTimezone(config()->string('speedclub.insights.timezone'))->toDateString();

        return $born !== null && $born > $first ? $born : $first;
    }

    private function delta(int $thisWeek, int $lastWeek): ?int
    {
        if ($lastWeek < max(1, config()->integer('speedclub.insights.delta_min_base'))) {
            return null;
        }

        return (int) round(($thisWeek - $lastWeek) / $lastWeek * 100);
    }

    private function trend(int $thisWeek, int $lastWeek): string
    {
        return match (true) {
            $lastWeek === 0 && $thisWeek > 0 => 'new',
            $thisWeek > $lastWeek => 'up',
            $thisWeek < $lastWeek => 'down',
            default => 'same',
        };
    }

    /**
     * "Dein E46 wurde diese Woche 128-mal angesehen – 31 % mehr als letzte Woche." A decrease never gets a percentage or a word for it.
     */
    private function headline(?Vehicle $vehicle, int $thisWeek, int $lastWeek): string
    {
        if ($thisWeek === 0) {
            // The profile scope asks to share the profile, a car's scope the build (lead, after DQ-P5-036).
            return (string) __($vehicle === null ? 'insights.headline.zero_account' : 'insights.headline.zero');
        }

        $subject = $vehicle === null
            ? (string) __('insights.subject.account')
            : (string) __('insights.subject.vehicle', ['title' => $this->name($vehicle)]);
        $delta = $this->delta($thisWeek, $lastWeek);
        $case = match (true) {
            $lastWeek === 0 => 'new',
            $delta !== null && $delta > 0 => 'up',
            $delta !== null && $delta < 0 => 'down',
            default => 'plain',
        };

        return trans_choice('insights.headline.'.$case, $thisWeek, [
            'subject' => $subject,
            'subject_lower' => app()->getLocale() === 'de' ? lcfirst($subject) : $subject,
            'count' => $this->number($thisWeek),
            'previous' => $this->number($lastWeek),
            'percent' => $this->number((int) $delta),
        ]);
    }

    private function name(Vehicle $vehicle): string
    {
        $nickname = trim((string) $vehicle->getAttribute('nickname'));

        return $nickname !== '' ? $nickname : ($this->presenter->shortTitle($vehicle) ?? $this->presenter->fullTitle($vehicle));
    }

    private function number(int $value): string
    {
        return app()->getLocale() === 'de' ? number_format($value, 0, ',', '.') : number_format($value);
    }
}
