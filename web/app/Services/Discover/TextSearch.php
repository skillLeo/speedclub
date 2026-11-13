<?php

namespace App\Services\Discover;

use App\Enums\SearchSort;
use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Search\SearchTerms;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Query\Builder;
use Illuminate\Pagination\AbstractCursorPaginator;
use Illuminate\Support\Facades\DB;

/**
 * DISC-02: text results for vehicles and members (02_PRODUCT_SPEC §3.7, 05_ARCHITECTURE §10), with the filters and sorts of M2.3
 * (SearchFilters, SearchSort). Facets are SearchFacets, the query understanding into chips QueryInterpreter.
 *
 * Vehicles: every typed word (SearchTerms::queryWords) must start a word of the build's search_keys, which hold make, model,
 * generation, nickname, engine code, description and the installed mods' titles, brands, parts and searchable fields. Relevance
 * is the sum over the typed words of 3 when it is a whole word of title_keys (make, model, generation, nickname, engine code),
 * 2 when it starts one, 1 when it only starts a word elsewhere; ties go to the build changed last, then the id.
 *
 * Members: discoverable, active, verified members with a username and no block either way. Every typed word must start the
 * username, a part of it after "." or "_", a word of the display name or a word of the city (M2.3: "stutt" finds Stuttgart). Relevance: 10 when the username is the whole query,
 * 5 when it starts with it, plus per word 2 for a username or display-name start and 1 for a later part; ties by username.
 */
class TextSearch
{
    private const ESCAPE = " ESCAPE '!'";

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * Builds by text and filters (M2.3). $words null means no text: every visible build that passes the filters ("Alle" of Neue Builds,
     * a collection, a model page). $sort null is relevance with a text and newest without; relevance without a text is newest too.
     * $list names the list in the cursor's signature, so a cursor of a model page does not continue a search.
     *
     * @param  list<string>|null  $words  from SearchTerms::queryWords
     * @return CursorPaginator<int, Vehicle>
     */
    public function vehicles(?User $viewer, ?array $words, int $perPage, ?SearchFilters $filters = null, ?SearchSort $sort = null, string $list = 'search'): CursorPaginator
    {
        $filters ??= new SearchFilters;
        $sort = self::sortFor($words, $sort);
        $hits = $this->matching($viewer, $words, $filters)
            ->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at')
            ->selectRaw('? as '.SearchCursor::COLUMN, [SearchCursor::signature($list, $words, $filters, $sort)]);

        if ($sort === SearchSort::Relevance) {
            $score = '0';
            $bindings = [];

            foreach ($words ?? [] as $word) {
                $escaped = SearchTerms::escapeLike($word);
                $score .= ' + CASE WHEN vs.title_keys LIKE ?'.self::ESCAPE.' THEN 3 WHEN vs.title_keys LIKE ?'.self::ESCAPE.' THEN 2 ELSE 1 END';
                array_push($bindings, "% $escaped %", "% $escaped%");
            }

            $hits->selectRaw('('.$score.') as relevance', $bindings);
        } elseif ($sort === SearchSort::Newest) {
            // Stored generated columns, COALESCE(published_at, updated_at) and COALESCE(power_ps, -1), each indexed with is_public and
            // updated_at: the page walks the index from the cursor instead of sorting every visible build (M2.3 review item 21).
            $hits->addSelect('vs.published_sort as published_sort');
        } elseif ($sort === SearchSort::Power) {
            $hits->addSelect('vs.power_sort as power_sort');
        }

        return $this->builds->paginate($hits, [SearchCursor::COLUMN => 'desc', ...SearchCursor::orders($sort)], $perPage);
    }

    /**
     * @param  list<string>|null  $words
     */
    public static function sortFor(?array $words, ?SearchSort $sort): SearchSort
    {
        if ($words === null) {
            return $sort === null || $sort === SearchSort::Relevance ? SearchSort::Newest : $sort;
        }

        return $sort ?? SearchSort::Relevance;
    }

    /**
     * @param  list<string>|null  $words
     */
    public function countVehicles(?User $viewer, ?array $words, ?SearchFilters $filters = null): ResultCount
    {
        return $this->capped($this->matching($viewer, $words, $filters ?? new SearchFilters));
    }

    /**
     * @param  list<string>  $words  from SearchTerms::nameWords
     * @return CursorPaginator<int, MemberHit>
     */
    public function members(?User $viewer, array $words, int $perPage): CursorPaginator
    {
        $whole = SearchTerms::escapeLike(implode('', $words));
        $score = 'CASE WHEN u.username = ? THEN 10 WHEN u.username LIKE ?'.self::ESCAPE.' THEN 5 ELSE 0 END';
        $bindings = [implode('', $words), "$whole%"];

        foreach ($words as $word) {
            $escaped = SearchTerms::escapeLike($word);
            $score .= ' + CASE WHEN u.username LIKE ?'.self::ESCAPE.' OR u.display_name LIKE ?'.self::ESCAPE.' THEN 2 ELSE 1 END';
            array_push($bindings, "$escaped%", "$escaped%");
        }

        $hits = $this->matchingMembers($viewer, $words)
            ->select('u.id', 'u.username')
            ->selectRaw('('.$score.') as relevance', $bindings);

        /** @var AbstractCursorPaginator<int, object> $page */
        $page = DB::query()->fromSub($hits, 'hits')
            ->orderByDesc('relevance')
            ->orderBy('username')
            ->cursorPaginate($perPage, ['*'], 'cursor');

        $rows = $page->getCollection();
        $members = User::query()->whereKey($rows->map(fn (object $row): string => (string) VisibleBuilds::column($row, 'id'))->all())->with('avatar')->get()->keyBy('id');

        $results = $rows->map(function (object $row) use ($members): ?MemberHit {
            $member = $members->get((string) VisibleBuilds::column($row, 'id'));

            return $member instanceof User
                ? new MemberHit($member, (string) VisibleBuilds::column($row, 'username'), (int) VisibleBuilds::column($row, 'relevance'))
                : null;
        })->filter()->values();

        $this->addGarages(array_values($results->all()));
        $this->addFollowing($viewer, array_values($results->all()));
        $page->setCollection($results);
        $page->withQueryString();

        /** @var CursorPaginator<int, MemberHit> $page */
        return $page;
    }

    /**
     * @param  list<string>  $words
     */
    public function countMembers(?User $viewer, array $words): ResultCount
    {
        return $this->capped($this->matchingMembers($viewer, $words));
    }

    /**
     * Counts no further than the cap: a LIMIT inside a derived table, which the database cannot merge away, so it stops reading
     * rows once one more than the cap matched.
     */
    private function capped(Builder $matches): ResultCount
    {
        $cap = config()->integer('speedclub.search.count_cap');
        $found = DB::query()->fromSub($matches->selectRaw('1 as hit')->limit($cap + 1), 'capped')->count();

        return new ResultCount(min($found, $cap), $found > $cap);
    }

    /**
     * Visible builds (VisibleBuilds) that hold every typed word and pass the filters, leaving out the facet group $except (SearchFacets).
     * No columns selected.
     *
     * @param  list<string>|null  $words  null: no text
     */
    public function matching(?User $viewer, ?array $words, SearchFilters $filters, ?string $except = null): Builder
    {
        // A query of nothing but characters with no ASCII form ("日本") has no words: it finds nothing rather than everything.
        $query = $this->builds->query($viewer)->when($words === [], fn (Builder $none) => $none->whereRaw('1 = 0'));

        foreach ($words ?? [] as $word) {
            $query->whereRaw('vs.search_keys LIKE ?'.self::ESCAPE, ['% '.SearchTerms::escapeLike($word).'%']);
        }

        return $filters->apply($query, $except);
    }

    /**
     * @param  list<string>  $words
     */
    private function matchingMembers(?User $viewer, array $words): Builder
    {
        $query = DB::table('users', 'u')
            ->where('u.discoverable', true)
            ->whereNotNull('u.username')
            ->whereNull('u.deleted_at')
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at');

        MemberNameFilter::apply($query, $words, withCity: true);
        $this->builds->withoutSamples($query, 'u.is_sample');

        return $this->builds->withoutBlocks($query, $viewer, 'u.id');
    }

    /**
     * Whether the viewer follows each member (DQ-326): one query for the page, never one per row. False for guests and for the viewer's
     * own row.
     *
     * @param  list<MemberHit>  $hits
     */
    public function addFollowing(?User $viewer, array $hits): void
    {
        if ($viewer === null || $hits === []) {
            return;
        }

        $followed = array_flip(array_map(strval(...), Follow::query()
            ->where('follower_id', $viewer->id)
            ->whereIn('followee_id', array_map(fn (MemberHit $hit): string => $hit->member->id, $hits))
            ->pluck('followee_id')
            ->all()));

        foreach ($hits as $hit) {
            $hit->isFollowing = isset($followed[$hit->member->id]);
        }
    }

    /**
     * "3 Fahrzeuge · BMW, Nissan": public builds as a profile lists them (MemberStats), main vehicle first, makes once each.
     *
     * @param  list<MemberHit>  $hits
     */
    public function addGarages(array $hits): void
    {
        if ($hits === []) {
            return;
        }

        $vehicles = Vehicle::query()
            ->whereIn('owner_id', array_map(fn (MemberHit $hit): string => $hit->member->id, $hits))
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->with('make')
            ->orderByDesc('is_main')
            ->orderBy('sort')
            ->orderBy('id')
            ->get(['id', 'owner_id', 'make_id', 'make_text', 'is_main', 'sort'])
            ->groupBy('owner_id');

        $max = config()->integer('speedclub.search.member_makes');

        foreach ($hits as $hit) {
            $garage = $vehicles->get($hit->member->id, collect());
            $hit->vehicleCount = $garage->count();
            $hit->makes = array_values($garage
                ->map(fn (Vehicle $vehicle): ?string => $this->presenter->makeName($vehicle))
                ->filter()
                ->unique()
                ->take($max)
                ->values()
                ->map(strval(...))
                ->all());
        }
    }
}
