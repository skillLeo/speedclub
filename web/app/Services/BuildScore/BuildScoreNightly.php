<?php

namespace App\Services\BuildScore;

use App\Enums\BuildScoreRankScope;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The Build Score night (m5.9c contract §3), run by build-score:nightly every five minutes from 00:30 to 01:55 Europe/Berlin through
 * the inline scheduler or cron (before dex:nightly reads the totals for the rarity tiers), until the day's tasks are done:
 *
 * 1. `scores`: every published car's score again (and every car that has one), the backstop for what no action reports — a photo
 *    rejected by moderation, a deleted or sample member, a block;
 * 2. `generation`: ranks per generation, one group per step;
 * 3. `bundesland`: ranks per Bundesland of the owner (users.bundesland), one group per step;
 * 4. `prune`: ranks not written tonight go (a car that left its group, went private or ghost, a group that fell under the minimum).
 *
 * Ranks only count public, published, non-ghost cars of active, verified, real members, never samples (they never stand next to real
 * cars), and are stored only for groups of at least build_score.ranks.min_group cars. Equal totals share a rank ("#2, #2, #4").
 * Idempotent and resumable like DexNightly: the task, its cursor and the night's start time live in the cache under the Berlin date; a
 * run stops after build_score.nightly.seconds; a cache lock keeps two runs apart.
 */
final class BuildScoreNightly
{
    public const TASKS = ['scores', 'generation', 'bundesland', 'prune'];

    public const LOCK = 'build-score:nightly:lock';

    public function __construct(private readonly BuildScores $scores) {}

    /**
     * @return array{done: bool, tasks: array<string, int>}|null null while another run holds the lock
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

    /**
     * Forgets the night's progress, so the next run starts with the first task again (a manual run, the F19 test helper).
     */
    public function restart(?CarbonImmutable $now = null): void
    {
        Cache::store()->forget(self::stateKey($now ?? CarbonImmutable::now()));
    }

    public static function stateKey(CarbonImmutable $now): string
    {
        return 'build-score:nightly:'.$now->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString();
    }

    /**
     * @return array{done: bool, tasks: array<string, int>}
     */
    private function resume(CarbonImmutable $now): array
    {
        $key = self::stateKey($now);
        $store = Cache::store();
        /** @var array{task?: string, cursor?: string|null, started?: string}|null $state */
        $state = $store->get($key);
        $task = $state['task'] ?? self::TASKS[0];
        $cursor = $state['cursor'] ?? null;
        $started = CarbonImmutable::parse($state['started'] ?? $now->toIso8601String());
        $deadline = microtime(true) + config()->integer('speedclub.build_score.nightly.seconds');
        $handled = [];

        while ($task !== 'done') {
            [$count, $cursor] = $this->step($task, $cursor, $started, $deadline);
            $handled[$task] = ($handled[$task] ?? 0) + $count;

            if ($cursor === null) {
                $index = array_search($task, self::TASKS, true);
                $task = is_int($index) && isset(self::TASKS[$index + 1]) ? self::TASKS[$index + 1] : 'done';
            }

            $store->put($key, ['task' => $task, 'cursor' => $cursor, 'started' => $started->toIso8601String()], now()->addDays(2));

            if (microtime(true) > $deadline) {
                break;
            }
        }

        return ['done' => $task === 'done', 'tasks' => $handled];
    }

    /**
     * @return array{0: int, 1: string|null} rows handled, and where to continue (null: the task is finished)
     */
    private function step(string $task, ?string $cursor, CarbonImmutable $started, float $deadline): array
    {
        return match ($task) {
            'scores' => $this->scoresChunk($cursor, $deadline),
            'generation' => $this->rankGroup(BuildScoreRankScope::Generation, $cursor, $started),
            'bundesland' => $this->rankGroup(BuildScoreRankScope::Bundesland, $cursor, $started),
            // The demo's rank rows of sample builds (GiftDemoSeeder, ADR-512 b) are not this job's: it never writes them, so it keeps them.
            'prune' => [DB::table('build_score_ranks')->where(fn (Builder $query) => $query->where('computed_at', '<', $started)->orWhereNull('computed_at'))
                ->whereNotIn('vehicle_id', DB::table('vehicles')->where('is_sample', true)->select('id'))->delete(), null],
            default => [0, null],
        };
    }

    /**
     * @return array{0: int, 1: string|null}
     */
    private function scoresChunk(?string $cursor, float $deadline): array
    {
        $ids = DB::table('vehicles as v')
            ->whereNull('v.deleted_at')
            ->where(fn (Builder $query) => $query
                ->where('v.status', VehicleStatus::Published->value)
                ->orWhereExists(fn (Builder $scores) => $scores->selectRaw('1')->from('build_scores as bs')->whereColumn('bs.vehicle_id', 'v.id')))
            ->when($cursor !== null, fn (Builder $query) => $query->where('v.id', '>', $cursor))
            ->orderBy('v.id')
            ->limit($this->chunk())
            ->pluck('v.id')
            ->map(strval(...))
            ->all();
        $done = 0;

        foreach ($ids as $id) {
            try {
                $this->scores->recompute($id);
            } catch (Throwable $exception) {
                report($exception);
            }

            $done++;

            if (microtime(true) > $deadline && $done < count($ids)) {
                return [$done, $id];
            }
        }

        return [$done, count($ids) < $this->chunk() ? null : (string) end($ids)];
    }

    /**
     * Ranks the next group of $scope after $cursor (a generation id or a Bundesland code).
     *
     * @return array{0: int, 1: string|null}
     */
    private function rankGroup(BuildScoreRankScope $scope, ?string $cursor, CarbonImmutable $started): array
    {
        $column = $scope === BuildScoreRankScope::Generation ? 'v.generation_id' : 'u.bundesland';
        $next = $this->eligible()
            ->whereNotNull($column)
            ->when($cursor !== null, fn (Builder $query) => $scope === BuildScoreRankScope::Generation
                ? $query->where($column, '>', (int) $cursor)
                : $query->where($column, '>', $cursor))
            ->orderBy($column)
            ->value($column);

        if ($next === null) {
            return [0, null];
        }

        $key = (string) $next;
        $rows = $this->eligible()->where($column, $next)->orderByDesc('bs.total')->get(['bs.vehicle_id', 'bs.total']);
        $size = $rows->count();

        if ($size < config()->integer('speedclub.build_score.ranks.min_group')) {
            // Too small for a rank: what it had goes with the prune.
            return [0, $key];
        }

        $records = [];
        $rank = 0;
        $previous = null;

        foreach ($rows->values() as $position => $row) {
            if ($previous === null || (int) $row->total < $previous) {
                $rank = $position + 1;
                $previous = (int) $row->total;
            }

            $records[] = [
                'vehicle_id' => (string) $row->vehicle_id,
                'scope' => $scope->value,
                'scope_key' => $key,
                'rank' => $rank,
                'group_size' => $size,
                'computed_at' => $started->addSecond(),
            ];
        }

        foreach (array_chunk($records, 500) as $chunk) {
            DB::table('build_score_ranks')->upsert($chunk, ['vehicle_id', 'scope'], ['scope_key', 'rank', 'group_size', 'computed_at']);
        }

        return [$size, $key];
    }

    /**
     * Scored cars that may be ranked (BuildScores::rankable, in SQL).
     */
    private function eligible(): Builder
    {
        return DB::table('build_scores as bs')
            ->join('vehicles as v', 'v.id', '=', 'bs.vehicle_id')
            ->join('users as u', 'u.id', '=', 'v.owner_id')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.visibility', Visibility::Public->value)
            ->where('v.ghost_mode', false)
            ->where('v.is_sample', false)
            ->whereNull('u.deleted_at')
            ->where('u.is_sample', false)
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at');
    }

    private function chunk(): int
    {
        return max(1, config()->integer('speedclub.build_score.nightly.chunk'));
    }
}
