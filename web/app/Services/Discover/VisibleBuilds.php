<?php

namespace App\Services\Discover;

use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Showcase\SampleContent;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Pagination\CursorPaginator as FrameworkCursorPaginator;
use Illuminate\Support\Facades\DB;

/**
 * The one source of every Phase 1 list of builds (HOME-01, DISC-01, DISC-02): rows of vehicle_search a viewer may see in a list.
 *
 * - public only: not unlisted (link and QR alone, 02_PRODUCT_SPEC §3.2), private, draft, archived or deleted, read from vehicles
 *   itself as well as from is_public, so a projection that lags behind cannot show what went private;
 * - the owner active and verified, read from users live: a suspension shows at once, although is_public only follows at the next
 *   rebuild (M1.6 handover). A suspension whose end has passed but whose status is still "suspended" stays out of lists until
 *   the status changes: lists fail closed, the vehicle page decides by the date (UserPolicy);
 * - no block in either direction between the viewer and the owner (§3.5);
 * - no sample build or sample owner while editorial_samples is off (09 §8.19, SampleContent).
 *
 * Plain SQL that runs the same on MySQL 8, MariaDB 10.6+ and the local MariaDB 10.4: joins (STRAIGHT_JOIN), NOT EXISTS, LIKE, CASE,
 * COALESCE.
 */
class VisibleBuilds
{
    public function __construct(private readonly SampleContent $samples) {}

    /**
     * From vehicle_search as vs, joined to vehicles as v and users as u. No columns selected yet.
     *
     * vehicle_search drives by default: STRAIGHT_JOIN reads vs first and looks up v and u by primary key, whatever InnoDB's
     * statistics say. Left to the optimizer, stale statistics (a new table, or a table that grew since its last sampling, and
     * shared hosts never run ANALYZE TABLE) can make it start from vehicles; then "Neue Builds" and the featured candidates lose
     * the backward scan of (is_public, updated_at) and sort every visible build before the limit. The order of reading does not
     * change which rows match. $fromSearch false leaves the order to the optimizer, for a caller that narrows by a column of
     * vehicles (the editorial list by public_id).
     */
    public function query(?User $viewer, bool $fromSearch = true): Builder
    {
        return $this->constrain(DB::table('vehicle_search', 'vs'), $viewer, $fromSearch ? 'straight_join' : 'inner');
    }

    /**
     * Visible, non-hidden build updates ("bu") of the builds query() lists, joined to vs, v and u (M2.2 Build-Updates, Für dich, Folge
     * ich). Read from build_updates first by default, newest first through its created_at index; $straight false leaves the order to
     * the optimizer, for a caller that narrows by another table (follows).
     */
    public function updates(?User $viewer, bool $straight = true): Builder
    {
        $join = $straight ? 'straight_join' : 'inner';
        $query = DB::table('build_updates', 'bu')
            ->join('vehicle_search as vs', 'vs.vehicle_id', '=', 'bu.vehicle_id', $join)
            ->where('bu.hidden', false);

        // M4.11 (09 §8.5): a followers-only update reaches only the owner and followers of the owner or the vehicle.
        BuildUpdate::audienceFor($query, $viewer, 'bu.audience', 'bu.vehicle_id', 'vs.owner_id');

        return $this->constrain($query, $viewer, $join);
    }

    /**
     * The rules of query() on a query that already holds vehicle_search as vs.
     */
    public function constrain(Builder $query, ?User $viewer, string $join = 'inner'): Builder
    {
        $query
            ->join('vehicles as v', 'v.id', '=', 'vs.vehicle_id', $join)
            ->join('users as u', 'u.id', '=', 'vs.owner_id', $join)
            ->where('vs.is_public', true)
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->where('v.visibility', Visibility::Public->value)
            ->whereNull('u.deleted_at')
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at');

        $this->samples->constrain($query, 'v.is_sample', 'u.is_sample');

        return $this->withoutBlocks($query, $viewer, 'vs.owner_id');
    }

    /**
     * Drops sample rows (their is_sample columns, qualified) while editorial_samples is off: for member lists that do not read through
     * query() (search, followers/following).
     */
    public function withoutSamples(Builder $query, string ...$columns): Builder
    {
        return $this->samples->constrain($query, ...$columns);
    }

    /** Whether sample content is shown (editorial_samples), for queries that add the owner's sample column inside a whereHas. */
    public function samplesVisible(): bool
    {
        return $this->samples->visible();
    }

    /**
     * Drops rows whose member column stands for somebody the viewer blocked or who blocked the viewer.
     */
    public function withoutBlocks(Builder $query, ?User $viewer, string $memberColumn): Builder
    {
        if ($viewer === null) {
            return $query;
        }

        // One NOT EXISTS per direction, not one over an OR: each is a lookup on an index of blocks ((blocker_id, blocked_id) and
        // blocked_id), so MySQL's anti-join keeps the order of the driving table. Over the OR it scans blocks into a join buffer,
        // and "Neue Builds" of a signed-in member lost the index order and sorted every visible build.
        return $query
            ->whereNotExists(fn (Builder $mine) => $mine->selectRaw('1')->from('blocks', 'b')
                ->where('b.blocker_id', $viewer->id)->whereColumn('b.blocked_id', $memberColumn))
            ->whereNotExists(fn (Builder $theirs) => $theirs->selectRaw('1')->from('blocks', 'bt')
                ->whereColumn('bt.blocker_id', $memberColumn)->where('bt.blocked_id', $viewer->id));
    }

    /**
     * When the build last changed, for "Neue Builds" and as the tie-break of every order. vehicle_search.updated_at copies
     * vehicles.updated_at at each rebuild and is never null (VehicleSearchProjector, and the backfill of migration
     * 2026_11_04_100000). The bare column, not an expression: so "Neue Builds" walks the index (is_public, updated_at) backwards,
     * with vehicle_id appended by InnoDB as the tie-break, and its cursor is a range on that index rather than a filter on every row.
     */
    public const CHANGED_AT = 'vs.updated_at';

    /**
     * A column of a row the query builder returned.
     */
    public static function column(object $row, string $name): mixed
    {
        return get_object_vars($row)[$name] ?? null;
    }

    /**
     * Cursor pages over a derived table, so the order may use computed columns (relevance) and the cursor is checked with the
     * same names. $hits must select `id` (the vehicle) and every order column.
     *
     * @param  array<string, 'asc'|'desc'>  $orders
     * @return CursorPaginator<int, Vehicle>
     */
    public function paginate(Builder $hits, array $orders, int $perPage): CursorPaginator
    {
        return $this->page($hits, $orders, $perPage);
    }

    /**
     * paginate() as the framework's paginator, for a caller that turns the vehicles into other rows (WheelSetups).
     *
     * @param  array<string, 'asc'|'desc'>  $orders
     * @return FrameworkCursorPaginator<int, Vehicle>
     */
    public function page(Builder $hits, array $orders, int $perPage): FrameworkCursorPaginator
    {
        $outer = DB::query()->fromSub($hits, 'hits');

        foreach ($orders as $column => $direction) {
            $outer->orderBy($column, $direction);
        }

        /** @var AbstractCursorPaginator<int, object> $page */
        $page = $outer->cursorPaginate($perPage, ['*'], 'cursor');
        $rows = $page->getCollection();
        $ids = array_values($rows->map(fn (object $row): string => (string) self::column($row, 'id'))->all());
        $vehicles = $this->vehicles($ids);

        // The cursor reads its values from the items: they keep the row's order columns.
        $page->setCollection($rows->map(function (object $row) use ($vehicles, $orders): ?Vehicle {
            $vehicle = $vehicles[(string) self::column($row, 'id')] ?? null;

            foreach (array_keys($orders) as $column) {
                $vehicle?->setAttribute($column, self::column($row, $column));
            }

            return $vehicle;
        })->filter()->values());

        $page->withQueryString();

        /** @var FrameworkCursorPaginator<int, Vehicle> $page */
        return $page;
    }

    /**
     * Loaded for the cards, keyed by id. A vehicle deleted between the two queries simply drops out.
     *
     * @param  list<string>  $ids
     * @return array<string, Vehicle>
     */
    public function vehicles(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Vehicle::query()
            ->whereKey($ids)
            ->with(FeedVehicleResource::RELATIONS)
            ->withCount('modifications')
            ->get()
            ->keyBy('id')
            ->all();
    }
}
