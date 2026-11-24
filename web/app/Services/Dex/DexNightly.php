<?php

namespace App\Services\Dex;

use App\Enums\Rarity;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The STREET DEX night (m5.9b contract §6), run by dex:nightly every ten minutes from 02:00 to 05:50 Europe/Berlin through the inline
 * scheduler or cron, until the day's tasks are done:
 *
 * 1. `numbers`: Dex numbers for published cars without one (DexNumbers::assignMissing, the backstop of PublishVehicle), within the
 *    run's deadline;
 * 2. `rarity`: every published car's tier (RarityRules::tier, from the public cars of its generation and, once M5.9c exists, its Build
 *    Score), in bulk per chunk; ghost mode is applied when shown, the stored tier stays the computed one;
 * 3. `stats`: vehicle_spot_stats of every car with spots or a stats row (SpotStats::recompute), so a removed spot or a deleted spotter
 *    is reflected;
 * 4. `sets`: the stored set progress of every member with progress or counted spots (DexSets::repair), which also corrects the spotters
 *    of a deleted account's cars (SpotPurger removed those spots without touching their progress).
 *
 * Idempotent and resumable: each task walks its rows by id in chunks of `dex.nightly.chunk`; a run stops after `dex.nightly.seconds`
 * and keeps the task and the last id in the cache under the Berlin date, and the next run continues there. Lost state only means a task
 * starts again. A cache lock keeps two runs from overlapping (the inline scheduler on a slow host, a manual run).
 */
final class DexNightly
{
    public const TASKS = ['numbers', 'rarity', 'stats', 'sets'];

    public const LOCK = 'dex:nightly:lock';

    public function __construct(
        private readonly DexNumbers $numbers,
        private readonly RarityRules $rarity,
        private readonly SpotStats $stats,
        private readonly DexSets $sets,
    ) {}

    /**
     * @return array{done: bool, tasks: array<string, int>}|null the rows each task handled in this run and whether the night is done;
     *                                                           null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null): ?array
    {
        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            return $this->resume($now ?? CarbonImmutable::now());
        } finally {
            $lock->release();
        }
    }

    public static function stateKey(CarbonImmutable $now): string
    {
        return 'dex:nightly:'.$now->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString();
    }

    /**
     * @return array{done: bool, tasks: array<string, int>}
     */
    private function resume(CarbonImmutable $now): array
    {
        $key = self::stateKey($now);
        $store = $this->store();
        /** @var array{task?: string, cursor?: string|null}|null $state */
        $state = $store->get($key);
        $task = $state['task'] ?? self::TASKS[0];
        $cursor = $state['cursor'] ?? null;
        $deadline = microtime(true) + config()->integer('speedclub.dex.nightly.seconds');
        $handled = [];

        while ($task !== 'done') {
            [$count, $cursor] = $this->step($task, $cursor, $deadline);
            $handled[$task] = ($handled[$task] ?? 0) + $count;

            if ($cursor === null) {
                $index = array_search($task, self::TASKS, true);
                $task = is_int($index) && isset(self::TASKS[$index + 1]) ? self::TASKS[$index + 1] : 'done';
            }

            $store->put($key, ['task' => $task, 'cursor' => $cursor], now()->addDays(2));

            if (microtime(true) > $deadline) {
                break;
            }
        }

        return ['done' => $task === 'done', 'tasks' => $handled];
    }

    /**
     * One chunk of a task after $cursor. Returns the rows handled and the cursor to continue at, null when the task is finished.
     *
     * @return array{0: int, 1: string|null}
     */
    private function step(string $task, ?string $cursor, float $deadline): array
    {
        return match ($task) {
            // CR-P5G-12: bounded by the run's deadline like the other steps; the next run goes on while cars are left.
            'numbers' => $this->numbersChunk($deadline),
            'rarity' => $this->rarityChunk($cursor),
            'stats' => $this->statsChunk($cursor, $deadline),
            'sets' => $this->setsChunk($cursor, $deadline),
            default => [0, null],
        };
    }

    /**
     * @return array{0: int, 1: string|null}
     */
    private function numbersChunk(float $deadline): array
    {
        $count = $this->numbers->assignMissing($deadline);

        // No id cursor is needed: a numbered car leaves the filter. 'more' only keeps the task open.
        return [$count, $this->numbers->missing() ? 'more' : null];
    }

    /**
     * @return array{0: int, 1: string|null}
     */
    private function rarityChunk(?string $cursor): array
    {
        $rows = DB::table('vehicles')
            ->whereNull('deleted_at')
            ->where('status', VehicleStatus::Published->value)
            ->when($cursor !== null, fn ($query) => $query->where('id', '>', $cursor))
            ->orderBy('id')
            ->limit($this->chunk())
            ->get(['id', 'generation_id', 'visibility']);

        if ($rows->isEmpty()) {
            return [0, null];
        }

        $generations = $rows->pluck('generation_id')->filter()->unique()->values()->all();
        // Public published cars per generation of this chunk, in one query.
        $public = DB::table('vehicles')
            ->whereNull('deleted_at')
            ->where('status', VehicleStatus::Published->value)
            ->where('visibility', Visibility::Public->value)
            ->whereIn('generation_id', $generations)
            ->groupBy('generation_id')
            ->selectRaw('generation_id, COUNT(*) as cars')
            ->pluck('cars', 'generation_id')
            ->all();
        $ids = array_values($rows->pluck('id')->map(strval(...))->all());
        $scores = $this->rarity->scores($ids);
        $tiers = [];

        foreach ($rows as $row) {
            $generation = $row->generation_id;
            $same = null;

            if ($generation !== null) {
                $same = (int) ($public[$generation] ?? 0) - ($row->visibility === Visibility::Public->value ? 1 : 0) + 1;
            }

            $tiers[$this->rarity->tier($same, $scores[(string) $row->id] ?? null)->value][] = (string) $row->id;
        }

        foreach ($tiers as $tier => $vehicleIds) {
            DB::table('vehicles')->whereIn('id', $vehicleIds)->update(['rarity' => Rarity::from($tier)->value, 'rarity_computed_at' => now()]);
        }

        return [count($ids), $rows->count() < $this->chunk() ? null : (string) $rows->last()->id];
    }

    /**
     * @return array{0: int, 1: string|null}
     */
    private function statsChunk(?string $cursor, float $deadline): array
    {
        $ids = DB::table('vehicles', 'v')
            ->when($cursor !== null, fn ($query) => $query->where('v.id', '>', $cursor))
            ->where(fn ($query) => $query
                ->whereExists(fn ($spots) => $spots->select(DB::raw(1))->from('spots as s')->whereColumn('s.vehicle_id', 'v.id'))
                ->orWhereExists(fn ($stats) => $stats->select(DB::raw(1))->from('vehicle_spot_stats as st')->whereColumn('st.vehicle_id', 'v.id')))
            ->orderBy('v.id')
            ->limit($this->chunk())
            ->pluck('v.id')
            ->map(strval(...))
            ->all();

        $done = 0;

        foreach ($ids as $id) {
            // CR-P5G-15: under the car's row lock, as RecordSpot recomputes, so a spot committing meanwhile is never overwritten by older
            // numbers (lock order vehicle → stats, the same as RecordSpot's).
            $this->attempt(fn () => DB::transaction(function () use ($id): void {
                DB::table('vehicles')->where('id', $id)->lockForUpdate()->value('id');
                $this->stats->recompute($id);
            }, 3));
            $done++;

            // A slow host: stop inside the chunk, the next run continues after this car.
            if (microtime(true) > $deadline && $done < count($ids)) {
                return [$done, $id];
            }
        }

        return [$done, count($ids) < $this->chunk() ? null : (string) end($ids)];
    }

    /**
     * @return array{0: int, 1: string|null}
     */
    private function setsChunk(?string $cursor, float $deadline): array
    {
        $members = User::query()
            ->when($cursor !== null, fn ($query) => $query->where('id', '>', $cursor))
            ->where(fn ($query) => $query
                ->whereExists(fn ($rows) => $rows->select(DB::raw(1))->from('user_set_progress as p')->whereColumn('p.user_id', 'users.id'))
                ->orWhereExists(fn ($spots) => $spots->select(DB::raw(1))->from('spots as s')->whereColumn('s.spotter_id', 'users.id')->where('s.counted', true)))
            ->orderBy('id')
            ->limit($this->chunk())
            ->get();

        $done = 0;

        foreach ($members as $member) {
            $this->attempt(fn () => $this->sets->repair($member));
            $done++;

            if (microtime(true) > $deadline && $done < $members->count()) {
                return [$done, (string) $member->id];
            }
        }

        return [$members->count(), $members->count() < $this->chunk() ? null : (string) $members->last()?->id];
    }

    /**
     * One car or member failing (a row deleted meanwhile) does not stop the night; it is reported and the walk goes on.
     *
     * @param  callable(): mixed  $work
     */
    private function attempt(callable $work): void
    {
        try {
            $work();
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    private function chunk(): int
    {
        return max(1, config()->integer('speedclub.dex.nightly.chunk'));
    }

    private function store(): Repository
    {
        return Cache::store();
    }
}
