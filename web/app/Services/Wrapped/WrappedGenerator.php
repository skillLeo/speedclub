<?php

namespace App\Services\Wrapped;

use App\Enums\RsvpStatus;
use App\Enums\UserStatus;
use App\Models\User;
use App\Models\Wrapped;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Writes the Wrapped of a season (m5.9e contract §2): one member (`generate`, the admin preview and `--user`) or every member in
 * chunks (`run`, GenerateWrapped and the nightly command). Idempotent: one row per member and season (unique pair, upsert); the same
 * data writes the same payload. A member without activity in the season gets no row (and loses a stale one). Samples are never
 * generated in production.
 *
 * `run` walks members by id in chunks of `wrapped.chunk` after a cursor kept in the cache under the season and run key (runKey(): the
 * release moment, so a pass is per season and release, CR-P5G-05), stops after `wrapped.seconds` and continues there in the next run,
 * on the next day too: an unfinished pass is never started over. A finished pass does nothing more that Berlin day; on a later day the
 * next run starts a fresh pass (the payloads follow the data until the release). `passCompleted()` tells WrappedReleases::due() whether
 * a season released already still needs its first full pass (CR-P5G-06). A cache lock per season keeps two runs apart. Lost state only
 * means the pass starts again, which writes the same rows. Only active members (CR-P5G-22: never suspended or deactivated ones).
 */
final class WrappedGenerator
{
    /** How long a pass's state is kept: past the release and its catch-up window (WrappedReleases::due). */
    private const STATE_DAYS = 30;

    public function __construct(
        private readonly WrappedPayloadBuilder $builder,
        private readonly WrappedCardImages $images,
        private readonly PercentileGroups $groups,
    ) {}

    /**
     * The run key of a season's passes: its release moment (UTC), or `manual` for a season without one (a staff or deploy run).
     */
    public static function runKey(?CarbonImmutable $release): string
    {
        return $release === null ? 'manual' : 'release-'.$release->utc()->format('YmdHis');
    }

    /**
     * Whether at least one full pass of the season for this run key has finished (every candidate member generated once).
     */
    public static function passCompleted(Season $season, string $runKey): bool
    {
        $state = Cache::get(self::stateKey($season, $runKey));

        return is_array($state) && (int) ($state['passes'] ?? 0) >= 1;
    }

    /**
     * The member's Wrapped of the season, written now; null when there is nothing to show (or a sample in production).
     */
    public function generate(User $member, Season $season, ?CarbonImmutable $now = null): ?Wrapped
    {
        $now ??= CarbonImmutable::now();
        $sample = $member->getAttribute('is_sample') === true;

        if ($sample && app()->isProduction()) {
            return null;
        }

        $payload = $this->builder->build($member, $season, $now);
        $existing = Wrapped::query()->where('user_id', $member->id)->where('season_key', $season->key)->first();

        if ($payload === null) {
            if ($existing !== null) {
                $existing->delete();
                $this->images->forget($member->id, $season->key);
            }

            return null;
        }

        if ($existing !== null && $existing->payload != $payload) {
            $this->images->forget($member->id, $season->key);
        }

        Wrapped::query()->upsert([[
            'id' => strtolower((string) Str::ulid()),
            'user_id' => $member->id,
            'season_key' => $season->key,
            'payload' => json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
            'is_sample' => $sample,
            'generated_at' => $now->utc(),
            'shared_count' => 0,
            'created_at' => $now->utc(),
            'updated_at' => $now->utc(),
        ]], ['user_id', 'season_key'], ['payload', 'is_sample', 'generated_at', 'updated_at']);

        return Wrapped::query()->where('user_id', $member->id)->where('season_key', $season->key)->first();
    }

    /**
     * One budgeted pass over the members; null while another run of the season holds the lock.
     *
     * @return array{done: bool, members: int, written: int}|null
     */
    public function run(Season $season, string $runKey, ?CarbonImmutable $now = null): ?array
    {
        $lock = Cache::lock('wrapped:generate:lock:'.$season->key, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            $this->groups->begin();

            return $this->resume($season, $runKey, $now ?? CarbonImmutable::now());
        } finally {
            $this->groups->end();
            $lock->release();
        }
    }

    public static function stateKey(Season $season, string $runKey): string
    {
        return 'wrapped:generate:'.$season->key.':'.$runKey;
    }

    public function restart(Season $season, string $runKey): void
    {
        Cache::forget(self::stateKey($season, $runKey));
    }

    /**
     * @return array{done: bool, members: int, written: int}
     */
    private function resume(Season $season, string $runKey, CarbonImmutable $now): array
    {
        $key = self::stateKey($season, $runKey);
        /** @var array{cursor?: string|null, done?: bool, completed_on?: string|null, passes?: int}|null $state */
        $state = Cache::get($key);
        $today = CarbonImmutable::now(config()->string('speedclub.wrapped.timezone'))->toDateString();
        $passes = (int) ($state['passes'] ?? 0);

        if (($state['done'] ?? false) === true) {
            // Done for today; a later day starts a fresh pass. A state without the day (written before CR-P5G-05) counts as today's.
            if (($state['completed_on'] ?? $today) >= $today) {
                return ['done' => true, 'members' => 0, 'written' => 0];
            }

            $state = ['cursor' => null, 'done' => false];
        }

        $cursor = $state['cursor'] ?? null;
        $save = function (bool $done, ?string $completedOn) use ($key, &$cursor, &$passes): void {
            Cache::put($key, ['cursor' => $cursor, 'done' => $done, 'completed_on' => $completedOn, 'passes' => $passes], now()->addDays(self::STATE_DAYS));
        };
        $deadline = microtime(true) + config()->integer('speedclub.wrapped.seconds');
        $members = 0;
        $written = 0;
        $done = false;

        // At least one member per run, so even a run that starts late moves on.
        do {
            $chunk = $this->candidates($season, $now)
                ->when($cursor !== null, fn ($query) => $query->where('id', '>', $cursor))
                ->orderBy('id')
                ->limit(config()->integer('speedclub.wrapped.chunk'))
                ->get();

            if ($chunk->isEmpty()) {
                $done = true;

                break;
            }

            foreach ($chunk as $member) {
                $written += $this->generate($member, $season, $now) === null ? 0 : 1;
                $members++;
                $cursor = $member->id;

                if (microtime(true) >= $deadline) {
                    break;
                }
            }

            $save(false, null);
        } while (microtime(true) < $deadline);

        if ($done) {
            $passes++;
            $cursor = null;
        }

        $save($done, $done ? $today : null);

        return ['done' => $done, 'members' => $members, 'written' => $written];
    }

    /**
     * Members who may have something in the season: a car, a spot or a meet answer in it, or a row to refresh. Only active members:
     * suspended and deactivated ones are left out (their row stays as it is; CR-P5G-22); samples only outside production.
     *
     * @return \Illuminate\Database\Eloquent\Builder<User>
     */
    private function candidates(Season $season, CarbonImmutable $now): \Illuminate\Database\Eloquent\Builder
    {
        $until = $season->toUtc()->min($now->utc());

        return User::query()
            ->where('status', UserStatus::Active->value)
            ->when(app()->isProduction(), fn ($query) => $query->where('is_sample', false))
            ->where(fn ($query) => $query
                ->whereExists(fn (Builder $cars) => $cars->selectRaw('1')->from('vehicles')->whereColumn('vehicles.owner_id', 'users.id')->whereNull('vehicles.deleted_at'))
                ->orWhereExists(fn (Builder $spots) => $spots->selectRaw('1')->from('spots')->whereColumn('spots.spotter_id', 'users.id')
                    ->whereBetween('spots.created_at', [$season->fromUtc(), $until]))
                ->orWhereExists(fn (Builder $rsvps) => $rsvps->selectRaw('1')->from('event_rsvps')->whereColumn('event_rsvps.user_id', 'users.id')
                    ->where('event_rsvps.status', RsvpStatus::Going->value))
                ->orWhereExists(fn (Builder $rows) => $rows->selectRaw('1')->from('wrapped')->whereColumn('wrapped.user_id', 'users.id')
                    ->where('wrapped.season_key', $season->key)));
    }
}
