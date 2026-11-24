<?php

namespace App\Services\Dex;

use App\Models\SpotAlert;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The grouped owner alert (m5.9b contract §4, owner gift detail M5.9b), run every three hours by dex:spot-alerts: one notification per
 * car and Europe/Berlin day for the cars with new counted spots since their last alert ("Dein EK9 wurde heute 4-mal in Düsseldorf
 * gespottet."). The row carries the day's totals: every counted spot of that day, and the cities of its day spots (a night spot never
 * names its city for a single car; none at all while the owner hides the car's cities), so the second alert of a day updates the same
 * row instead of adding one. Never who spotted the car.
 *
 * spot_alerts keeps one row per run and car: window_start (the previous cutoff), sent_at (this run's cutoff), the new spots and their
 * day-spot cities. A car never told looks back `dex.alerts.lookback_hours` (24). The notification is written before the spot_alerts row,
 * so a run cut off between the two tells the same totals again, which Notifier's grouped row takes as no change (no second push).
 *
 * Pushes: only for the current Berlin day (a 00:00 run about the evening before stays in the list), never for a sample car to a real
 * member, and through Notifier's rules for the type: the SET-09 switch "Spots" (spot_alert), the member's quiet hours, the fixed social
 * quiet hours 22–08 and one social push per member and day (SocialPushLimiter). Each run stops after `dex.alerts.seconds`; the cars left
 * keep their old cutoff and come with the next run. A cache lock keeps two runs apart.
 */
final class SpotAlerts
{
    public const LOCK = 'dex:spot-alerts:lock';

    public function __construct(private readonly Notifier $notifier) {}

    /**
     * $vehicleIds narrows a run to those cars (support tooling: the F18 browser flow tells only its own test car).
     *
     * @param  list<string>|null  $vehicleIds
     * @return int|null cars whose owner was told (or whose row was refreshed), null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null, ?array $vehicleIds = null): ?int
    {
        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            // Whole seconds, like the stored times: the cutoff is exclusive, so a spot in the cutoff's second comes with the next run.
            return $this->send(($now ?? CarbonImmutable::now())->startOfSecond(), $vehicleIds);
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  list<string>|null  $only
     */
    private function send(CarbonImmutable $now, ?array $only): int
    {
        $deadline = microtime(true) + config()->integer('speedclub.dex.alerts.seconds');
        $chunk = max(1, config()->integer('speedclub.dex.alerts.chunk'));
        $told = 0;
        $after = null;

        do {
            $vehicleIds = $this->due($now, $after, $chunk, $only);

            foreach ($vehicleIds as $vehicleId) {
                $after = $vehicleId;

                try {
                    $told += $this->alert($vehicleId, $now);
                } catch (Throwable $exception) {
                    report($exception);
                }

                if (microtime(true) > $deadline) {
                    return $told;
                }
            }
        } while (count($vehicleIds) === $chunk);

        return $told;
    }

    /**
     * Cars (not deleted) with a counted spot at or after their last cutoff, within the look-back, in id order after $after.
     *
     * @param  list<string>|null  $only
     * @return list<string>
     */
    private function due(CarbonImmutable $now, ?string $after, int $chunk, ?array $only): array
    {
        return array_values(DB::table('spots', 's')
            ->join('vehicles as v', 'v.id', '=', 's.vehicle_id')
            ->whereNull('v.deleted_at')
            ->where('s.counted', true)
            ->whereNull('s.deleted_at')
            ->where('s.created_at', '>=', $this->lookback($now))
            ->where('s.created_at', '<', $now)
            ->whereNotExists(fn (Builder $alerts) => $alerts->select(DB::raw(1))->from('spot_alerts as a')
                ->whereColumn('a.vehicle_id', 's.vehicle_id')
                ->whereColumn('a.sent_at', '>', 's.created_at'))
            ->when($after !== null, fn (Builder $query) => $query->where('s.vehicle_id', '>', $after))
            ->when($only !== null, fn (Builder $query) => $query->whereIn('s.vehicle_id', $only))
            ->distinct()
            ->orderBy('s.vehicle_id')
            ->limit($chunk)
            ->pluck('s.vehicle_id')
            ->map(strval(...))
            ->all());
    }

    /**
     * @return int 1 when the owner's row was written or refreshed
     */
    private function alert(string $vehicleId, CarbonImmutable $now): int
    {
        $vehicle = Vehicle::query()->with(['owner', 'make', 'vehicleModel', 'generation'])->find($vehicleId);
        $owner = $vehicle?->owner;

        if (! $vehicle instanceof Vehicle || ! $owner instanceof User) {
            return 0;
        }

        $last = SpotAlert::query()->where('vehicle_id', $vehicleId)->max('sent_at');
        $since = $last === null ? $this->lookback($now) : CarbonImmutable::parse((string) $last, 'UTC')->max($this->lookback($now));
        $new = $this->counted($vehicleId)->where('created_at', '>=', $since)->where('created_at', '<', $now)->get(['created_at', 'city_id', 'is_night']);

        if ($new->isEmpty()) {
            return 0;
        }

        $zone = config()->string('speedclub.notifications.timezone');
        $today = $now->setTimezone($zone)->toDateString();
        $days = $new->map(fn (object $spot): string => CarbonImmutable::parse((string) $spot->created_at, 'UTC')->setTimezone($zone)->toDateString())->unique()->sort()->values();
        // Sample cars belong to sample accounts; a real member who owns one (the demo) never gets a push about it.
        $mayPush = ! ($vehicle->is_sample && ! $owner->is_sample);
        $written = 0;

        foreach ($days as $day) {
            $start = CarbonImmutable::parse($day.' 00:00:00', $zone)->utc();
            $end = CarbonImmutable::parse($day.' 00:00:00', $zone)->addDay()->utc()->min($now);
            $count = $this->counted($vehicleId)->where('created_at', '>=', $start)->where('created_at', '<', $end)->count();
            $cities = $vehicle->hide_spot_cities ? [] : $this->counted($vehicleId)->where('created_at', '>=', $start)->where('created_at', '<', $end)
                ->where('is_night', false)->whereNotNull('city_id')->distinct()->pluck('city_id')->map(intval(...))->all();

            if ($this->notifier->spotAlert($owner, $vehicle, $day, $count, array_values($cities), $mayPush && $day === $today) !== null) {
                $written = 1;
            }
        }

        $newCities = $vehicle->hide_spot_cities ? [] : $new->where('is_night', false)->pluck('city_id')->filter()->map(intval(...))->unique()->sort()->values()->all();
        $alert = new SpotAlert;
        $alert->forceFill([
            'vehicle_id' => $vehicleId,
            'window_start' => $since,
            'count' => $new->count(),
            'city_ids' => $newCities,
            'sent_at' => $now,
        ])->save();

        return $written;
    }

    private function counted(string $vehicleId): Builder
    {
        return DB::table('spots')->where('vehicle_id', $vehicleId)->where('counted', true)->whereNull('deleted_at');
    }

    private function lookback(CarbonImmutable $now): CarbonImmutable
    {
        return $now->subHours(config()->integer('speedclub.dex.alerts.lookback_hours'));
    }
}
