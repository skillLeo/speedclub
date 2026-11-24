<?php

namespace App\Services\BuildScore;

use App\Enums\BuildScoreRankScope;
use App\Enums\Bundesland;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Jobs\BuildScore\RecomputeBuildScore;
use App\Models\BuildScore;
use App\Models\BuildScoreHistory;
use App\Models\BuildScoreRank;
use App\Models\Generation;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * M5.9c Build Score (10 §16.3, m5.9c contract §3–§4): stores what BuildScoreCalculator computes from BuildScoreInputs, keeps the day
 * history and the total before the last change ("+25"), and reads a score with its ranks for the API.
 *
 * Edits reach it through touch(): every action that changes what the score counts (photos, specs, description, cover and focal point,
 * mods, build updates, reactions, follows, spots, blocks) calls it, and RecomputeBuildScore runs debounced. The nightly run
 * (BuildScoreNightly) recomputes every score again, which also covers what no action reports (moderation, deleted members).
 *
 * @phpstan-import-type Result from BuildScoreCalculator
 * @phpstan-import-type Upgrade from BuildScoreCalculator
 *
 * @phpstan-type Rank array{scope: string, label: string, rank: int, group_size: int, region: string|null}
 * @phpstan-type Read array{total: int, stage: int, parts?: array<string, array{points: int, max: int}>, ranks: list<Rank>, computed_at: string|null, previous_total?: int|null, formula_version: string, next_upgrades?: list<Upgrade>}
 */
class BuildScores
{
    public function __construct(
        private readonly BuildScoreCalculator $calculator,
        private readonly BuildScoreInputs $inputs,
    ) {}

    /**
     * Queues the debounced recompute of $vehicleId after the current transaction commits. Never throws: the score is a side effect.
     */
    public function touch(?string $vehicleId): void
    {
        if ($vehicleId === null || $vehicleId === '') {
            return;
        }

        $id = strtolower($vehicleId);

        // As the share cards and OG images: queued once the edit is stored (at once outside a transaction).
        DB::afterCommit(function () use ($id): void {
            try {
                RecomputeBuildScore::dispatch($id)->delay(now()->addSeconds(config()->integer('speedclub.build_score.debounce_seconds')));
            } catch (Throwable $exception) {
                report($exception);
            }
        });
    }

    /**
     * After a block between two members: the community counts of their cars change.
     */
    public function touchOwnersOf(string ...$userIds): void
    {
        $ids = Vehicle::query()->whereIn('owner_id', $userIds)->pluck('id');

        foreach ($ids as $id) {
            $this->touch((string) $id);
        }
    }

    /**
     * The car behind a morph alias and id (a vehicle, mod or build update: the parent of a photo, the target of a reaction).
     */
    public function touchFor(?string $type, ?string $id): void
    {
        if ($type === null || $id === null) {
            return;
        }

        $vehicleId = match ($type) {
            'vehicle' => $id,
            'modification' => DB::table('modifications')->where('id', $id)->value('vehicle_id'),
            'build_update' => DB::table('build_updates')->where('id', $id)->value('vehicle_id'),
            default => null,
        };

        $this->touch(is_string($vehicleId) ? $vehicleId : null);
    }

    /**
     * Computes and stores the score of $vehicleId now. Null for a vehicle that is gone.
     */
    public function recompute(string $vehicleId): ?BuildScore
    {
        $vehicle = Vehicle::query()->find(strtolower($vehicleId));

        return $vehicle instanceof Vehicle ? $this->store($vehicle, $this->calculator->calculate($this->inputs->for($vehicle))) : null;
    }

    /**
     * @param  Result  $result
     */
    public function store(Vehicle $vehicle, array $result, ?CarbonImmutable $now = null): BuildScore
    {
        $now ??= CarbonImmutable::now();

        return DB::transaction(function () use ($vehicle, $result, $now): BuildScore {
            $score = BuildScore::query()->whereKey($vehicle->id)->lockForUpdate()->first();
            $isNew = ! $score instanceof BuildScore;
            $score ??= new BuildScore;
            $changed = $isNew || $score->total !== $result['total'];

            $score->forceFill([
                'vehicle_id' => $vehicle->id,
                'total' => $result['total'],
                'completeness' => $result['parts']['completeness']['points'],
                'documentation' => $result['parts']['documentation']['points'],
                'community' => $result['parts']['community']['points'],
                'journey' => $result['parts']['journey']['points'],
                'stage' => $result['stage'],
                'breakdown' => $result['breakdown'],
                'formula_version' => $this->calculator->version(),
                'computed_at' => $now,
            ]);

            if ($changed) {
                $score->forceFill(['previous_total' => $isNew ? null : $score->getOriginal('total'), 'changed_at' => $now]);
            }

            $score->save();

            if ($changed) {
                $day = $now->setTimezone(config()->string('speedclub.notifications.timezone'))->toDateString();
                BuildScoreHistory::query()->upsert([['vehicle_id' => $vehicle->id, 'day' => $day, 'total' => $result['total']]], ['vehicle_id', 'day'], ['total']);
            }

            return $score;
        });
    }

    /**
     * The score of a vehicle as GET vehicles/{id}/build-score answers it. Computed at once the first time a vehicle is asked for;
     * null only when that fails. `parts` and `next_upgrades` for the owner only: the community part is mostly 2 points per reacting
     * member, and reaction counts are private (10 §16, ADR-413), so a visitor gets the total, the stage and the ranks.
     *
     * @return Read|null
     */
    public function read(Vehicle $vehicle, bool $owner): ?array
    {
        $score = $vehicle->buildScore;

        if (! $score instanceof BuildScore) {
            try {
                $score = $this->recompute($vehicle->id);
            } catch (Throwable $exception) {
                report($exception);

                return null;
            }

            if ($score === null) {
                return null;
            }
        }

        $parts = [];

        foreach ($this->calculator->parts() as $part) {
            $parts[$part['key']] = ['points' => (int) $score->getAttribute($part['key']), 'max' => $part['max']];
        }

        $read = [
            'total' => $score->total,
            'stage' => $score->stage,
            'ranks' => $this->ranks($vehicle),
            'computed_at' => $score->computed_at?->toIso8601String(),
            'formula_version' => $score->formula_version,
        ];

        // Owner only, like the parts (review N-4): read after a recompute, the last step is exact, and a community step of 2 or 1 is
        // one new reaction, spotter or follower, which a visitor must not be able to count.
        if ($owner) {
            $read['previous_total'] = $score->previous_total;
            $read['parts'] = $parts;
            $read['next_upgrades'] = $this->calculator->nextUpgrades($this->inputs->for($vehicle));
        }

        return $read;
    }

    /**
     * The rank lines: generation first, then Bundesland; only while the car itself may be ranked (public, not ghost, not a sample) and
     * only for groups of at least build_score.ranks.min_group.
     *
     * R4DQ-09: the order is the night's (BuildScoreNightly, so a score change moves the rank only at night, m5.9c §3), but the group is
     * counted at read: a car that was deleted, unpublished, hidden, ghosted or whose owner left since the night no longer counts in the
     * group size, nor as a car above. "#k von N" is therefore always true; a group under the minimum shows no line.
     *
     * @return list<Rank>
     */
    public function ranks(Vehicle $vehicle): array
    {
        $demo = self::showsDemoRanks($vehicle);

        if (! self::rankable($vehicle) && ! $demo) {
            return [];
        }

        $min = config()->integer('speedclub.build_score.ranks.min_group');
        $rows = BuildScoreRank::query()->where('vehicle_id', $vehicle->id)->get()->keyBy(fn (BuildScoreRank $rank): string => $rank->scope->value);
        $ranks = [];
        $generation = $rows->get(BuildScoreRankScope::Generation->value);

        if ($generation instanceof BuildScoreRank && (string) $vehicle->generation_id === $generation->scope_key) {
            $live = $this->liveRank($generation, $demo);
            $name = Generation::query()->whereKey((int) $generation->scope_key)->value('name');

            if ($live['group_size'] >= $min && is_string($name) && $name !== '') {
                $ranks[] = [
                    'scope' => BuildScoreRankScope::Generation->value,
                    'label' => $name,
                    'rank' => $live['rank'],
                    'group_size' => $live['group_size'],
                    'region' => (string) __('build_score.region.germany'),
                ];
            }
        }

        $state = $rows->get(BuildScoreRankScope::Bundesland->value);
        $ownerState = $vehicle->owner?->getAttribute('bundesland');
        $ownerState = $ownerState instanceof Bundesland ? $ownerState->value : (is_string($ownerState) ? $ownerState : null);

        if ($state instanceof BuildScoreRank && Bundesland::tryFrom($state->scope_key) !== null && $ownerState === $state->scope_key) {
            $live = $this->liveRank($state, $demo);

            if ($live['group_size'] >= $min) {
                $ranks[] = [
                    'scope' => BuildScoreRankScope::Bundesland->value,
                    'label' => (string) __('build_score.bundesland.'.$state->scope_key),
                    'rank' => $live['rank'],
                    'group_size' => $live['group_size'],
                    'region' => null,
                ];
            }
        }

        return $ranks;
    }

    /**
     * The group of a stored rank as it is now: every car that may be ranked in it (for a demo row: the demo's ranked sample builds), and
     * the rank among them by the night's order (1 + the cars still in the group that ranked above; equal ranks stay shared).
     *
     * @return array{rank: int, group_size: int}
     */
    private function liveRank(BuildScoreRank $row, bool $demo): array
    {
        $column = $row->scope === BuildScoreRankScope::Generation ? 'v.generation_id' : 'u.bundesland';
        $key = $row->scope === BuildScoreRankScope::Generation ? (int) $row->scope_key : $row->scope_key;

        if ($demo) {
            // The demo's groups are its rank rows (GiftDemoSeeder): only those whose sample build is still shown count.
            $group = self::rankedCars($demo)->join('build_score_ranks as r', 'r.vehicle_id', '=', 'v.id')
                ->where('r.scope', $row->scope->value)->where('r.scope_key', $row->scope_key)->where($column, $key);
            $size = (clone $group)->count();
        } else {
            $size = self::rankedCars($demo)->join('build_scores as bs', 'bs.vehicle_id', '=', 'v.id')->where($column, $key)->count();
            $group = self::rankedCars($demo)->join('build_score_ranks as r', 'r.vehicle_id', '=', 'v.id')
                ->where('r.scope', $row->scope->value)->where('r.scope_key', $row->scope_key)->where($column, $key);
        }

        $above = (clone $group)->where('r.rank', '<', $row->rank)->count();

        return ['rank' => min($above + 1, max(1, $size)), 'group_size' => $size];
    }

    /**
     * The cars that may stand in a rank group now (rankable() in SQL, as BuildScoreNightly::eligible), or the demo's shown sample builds.
     */
    private static function rankedCars(bool $demo): QueryBuilder
    {
        $query = DB::table('vehicles as v')
            ->join('users as u', 'u.id', '=', 'v.owner_id')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.visibility', Visibility::Public->value)
            ->where('v.ghost_mode', false)
            ->whereNull('u.deleted_at');

        return $demo
            ? $query->where('v.is_sample', true)->where('u.is_sample', true)
            : $query->where('v.is_sample', false)->where('u.is_sample', false)
                ->where('u.status', UserStatus::Active->value)->whereNotNull('u.email_verified_at');
    }

    /**
     * Whether a car takes part in the ranks: published, public, not ghost, not a sample, its owner an active, verified, real member.
     */
    public static function rankable(Vehicle $vehicle): bool
    {
        $owner = $vehicle->owner;

        return ! $vehicle->trashed()
            && $vehicle->status === VehicleStatus::Published
            && $vehicle->visibility === Visibility::Public
            && $vehicle->ghost_mode !== true
            && $vehicle->getAttribute('is_sample') !== true
            && $owner instanceof User
            && $owner->getAttribute('is_sample') !== true
            && $owner->isPubliclyVisible();
    }

    /**
     * M5.9f (ADR-512 b): samples never rank, so the nightly job writes no row for them; the staging demo (GiftDemoSeeder) writes rank rows
     * among sample builds itself. They are shown only off production, for a published, public, non-ghost sample build of a sample owner.
     */
    public static function showsDemoRanks(Vehicle $vehicle): bool
    {
        return ! app()->isProduction()
            && $vehicle->getAttribute('is_sample') === true
            && ! $vehicle->trashed()
            && $vehicle->status === VehicleStatus::Published
            && $vehicle->visibility === Visibility::Public
            && $vehicle->ghost_mode !== true
            && $vehicle->owner instanceof User
            && $vehicle->owner->getAttribute('is_sample') === true;
    }

    /**
     * "So entsteht dein Build Score" (GET build-score/formula).
     *
     * @return array{max: int, stages: list<array{stage: int, min: int}>, parts: list<array{key: string, max: int, items: list<array{key: string, points: int, limit: int|null, max: int, min_chars?: int}>}>, formula_version: string}
     */
    public function formula(): array
    {
        $stages = [];

        foreach ($this->calculator->stages() as $stage => $from) {
            $stages[] = ['stage' => $stage, 'min' => $from];
        }

        return [
            'max' => $this->calculator->max(),
            'stages' => $stages,
            'parts' => $this->calculator->parts(),
            'formula_version' => $this->calculator->version(),
        ];
    }
}
