<?php

namespace App\Services\Home;

use App\Enums\UserStatus;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Save;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Garage\VehicleCompleteness;
use App\Services\Garage\VehiclePresenter;
use App\Support\HomeClock;
use App\Support\Slug;
use Carbon\CarbonImmutable;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Log;

/**
 * Writes the Für dich scores (RankScore), double-buffered by epoch (M2.2 review #8): an even epoch reads vehicle_search.rank_score, an
 * odd one rank_score_alt. php artisan home:rank (hourly, without overlapping) writes the column of the next epoch in chunks of CASE
 * updates and switches to it at the end, so every cursor reads one consistent set of scores; a run that hits its time budget does not
 * switch. search:rebuild runs it after a full rebuild; a row the projector creates gets its score in both columns at once.
 *
 * Signals, all counted at HomeClock::now(): when the build last changed (vehicle_search.updated_at), VehicleCompleteness, the long edge
 * of the cover photo, saves of the build by other active members in 7 days, follows of the owner by active members in 7 days, and the
 * editorial list (HomeCuration: the published ADM-29 curation, speedclub.home.featured_slugs while none is live).
 */
class HomeRanking
{
    public function __construct(
        private readonly VehicleCompleteness $completeness,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * The score column an epoch reads.
     *
     * @return 'rank_score'|'rank_score_alt'
     */
    public static function column(int $epoch): string
    {
        return $epoch % 2 === 0 ? 'rank_score' : 'rank_score_alt';
    }

    /**
     * @return array{epoch: int, writing: bool}
     */
    public function state(): array
    {
        $row = $this->db()->table('home_rank_state')->where('id', 1)->first();
        $values = $row === null ? [] : get_object_vars($row);

        return ['epoch' => (int) ($values['epoch'] ?? 0), 'writing' => (bool) ($values['writing'] ?? false)];
    }

    /**
     * Scores every public row into the next epoch's column and switches to it. Returns how many rows were scored, or null when the time
     * budget ran out (the epoch stays; the next run starts over).
     */
    public function rankAll(?CarbonImmutable $now = null): ?int
    {
        $now ??= HomeClock::now();
        $started = microtime(true);
        $budget = config()->integer('speedclub.home.ranking.max_seconds');
        $next = $this->state()['epoch'] + 1;
        $column = self::column($next);
        $count = 0;
        $complete = true;

        $this->db()->table('home_rank_state')->where('id', 1)->update(['writing' => true]);

        VehicleSearch::query()->toBase()->where('is_public', true)->select('vehicle_id')->orderBy('vehicle_id')
            ->chunk(config()->integer('speedclub.home.ranking.chunk'), function ($rows) use ($now, $column, $started, $budget, &$count, &$complete): bool {
                $count += $this->rankMany(array_values($rows->map(fn (object $row): string => (string) get_object_vars($row)['vehicle_id'])->all()), $now, [$column]);

                if (microtime(true) - $started > $budget) {
                    $complete = false;

                    return false;
                }

                return true;
            });

        if (! $complete) {
            Log::warning('home:rank stopped at its time budget; the scores of the current epoch stay.', ['scored' => $count]);

            return null;
        }

        $this->db()->table('home_rank_state')->where('id', 1)->update(['epoch' => $next, 'writing' => false, 'ranked_at' => CarbonImmutable::now()]);

        return $count;
    }

    /**
     * One row, into both columns: a new build is in every epoch at once.
     */
    public function rank(string $vehicleId, ?CarbonImmutable $now = null): void
    {
        $this->rankMany([$vehicleId], $now ?? HomeClock::now(), ['rank_score', 'rank_score_alt']);
    }

    /**
     * @param  list<string>  $ids
     * @param  list<string>  $columns
     */
    private function rankMany(array $ids, CarbonImmutable $now, array $columns): int
    {
        if ($ids === []) {
            return 0;
        }

        $since = $now->subDays(config()->integer('speedclub.home.ranking.engagement_days'));
        $changed = VehicleSearch::query()->whereIn('vehicle_id', $ids)->toBase()->pluck('updated_at', 'vehicle_id')->all();
        $vehicles = Vehicle::query()->whereKey($ids)->with(['specs', 'media', 'cover'])->withCount('modifications')->get();
        // Saves by others only: an owner cannot save the own build, and none from before that rule may count.
        $saves = $this->activeCount(
            Save::query()->toBase()->from('saves', 'x')->join('vehicles as sv', 'sv.id', '=', 'x.vehicle_id')->whereColumn('x.user_id', '!=', 'sv.owner_id')->whereIn('x.vehicle_id', $ids),
            'x.user_id', 'x.vehicle_id', $since, $now,
        );
        $followers = $this->activeCount(
            Follow::query()->toBase()->from('follows', 'x')->whereIn('x.followee_id', $vehicles->pluck('owner_id')->unique()->values()->all()),
            'x.follower_id', 'x.followee_id', $since, $now,
        );
        $boosted = $this->boostedPublicIds();
        $locale = (string) (config()->array('speedclub.locales')[0] ?? 'de');
        $scores = [];

        foreach ($vehicles as $vehicle) {
            $at = $changed[$vehicle->id] ?? null;
            $hours = is_string($at) ? max(0.0, (float) CarbonImmutable::parse($at, 'UTC')->diffInMinutes($now) / 60) : 0.0;
            $cover = $this->presenter->cover($vehicle, false);
            $edge = $cover instanceof Media ? max((int) $cover->getAttribute('width'), (int) $cover->getAttribute('height')) : null;

            $scores[$vehicle->id] = RankScore::score(
                $hours,
                $this->completeness->for($vehicle, $locale)['percent'],
                $edge > 0 ? $edge : null,
                $saves[$vehicle->id] ?? 0,
                $followers[$vehicle->owner_id] ?? 0,
                isset($boosted[$vehicle->public_id]),
            );
        }

        $this->write($scores, $columns);

        return count($scores);
    }

    /**
     * One UPDATE … CASE per chunk and column.
     *
     * @param  array<string, float>  $scores
     * @param  list<string>  $columns  rank_score and/or rank_score_alt, never anything a caller passed
     */
    private function write(array $scores, array $columns): void
    {
        if ($scores === []) {
            return;
        }

        $cases = [];
        $bindings = [];

        foreach ($scores as $id => $score) {
            $cases[] = 'WHEN ? THEN ?';
            $bindings[] = $id;
            $bindings[] = $score;
        }

        $ids = array_keys($scores);
        $in = implode(',', array_fill(0, count($ids), '?'));

        foreach (array_intersect($columns, ['rank_score', 'rank_score_alt']) as $column) {
            $this->db()->update(
                "UPDATE vehicle_search SET $column = CASE vehicle_id ".implode(' ', $cases)." ELSE $column END WHERE vehicle_id IN ($in)",
                [...$bindings, ...$ids],
            );
        }
    }

    /**
     * Rows in [$since, $now] by members who are active and verified, per $groupColumn.
     *
     * @return array<string, int>
     */
    private function activeCount(Builder $query, string $memberColumn, string $groupColumn, CarbonImmutable $since, CarbonImmutable $now): array
    {
        return $query
            ->join('users as m', 'm.id', '=', $memberColumn)
            ->whereNull('m.deleted_at')
            ->where('m.status', UserStatus::Active->value)
            ->whereNotNull('m.email_verified_at')
            ->whereBetween('x.created_at', [$since, $now])
            ->groupBy($groupColumn)
            ->select($groupColumn.' as id')
            ->selectRaw('COUNT(*) as total')
            ->pluck('total', 'id')
            ->map(fn (mixed $total): int => (int) $total)
            ->all();
    }

    /**
     * @return array<string, true> public ids of the editorial list
     */
    private function boostedPublicIds(): array
    {
        $ids = [];

        foreach (app(HomeCuration::class)->featuredSlugs() as $slug) {
            $publicId = Slug::publicId($slug);

            if ($publicId !== null) {
                $ids[$publicId] = true;
            }
        }

        return $ids;
    }

    /**
     * The models' connection, not the DB facade: the projector calls rank() inside its own transaction.
     */
    private function db(): ConnectionInterface
    {
        return VehicleSearch::query()->getConnection();
    }
}
