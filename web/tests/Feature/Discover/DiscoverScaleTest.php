<?php

use App\Enums\SearchSort;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Discover\TextSearch;
use Illuminate\Database\MySqlConnection;
use Illuminate\Pagination\Cursor;
use Illuminate\Pagination\CursorPaginator;
use Illuminate\Support\Facades\DB;

/**
 * M2.3 review item 21 (M2.8): "Neueste" and "Meiste PS" ordered by an expression, so every page read and sorted every visible build.
 * vehicle_search.published_sort and power_sort (stored generated columns, indexed with is_public and updated_at) let a page walk the
 * index from its cursor. Relevance stays a sort of the matches: its score depends on the typed words.
 *
 * The order is checked against a reference computed here from the seeded values, so the fix changed no result. The perf group seeds
 * 2,000 builds and times it (run alone by the phase gate, like DiscoverEndpointsTest); the shape check on 300 runs in every suite.
 */
afterEach(function () {
    CursorPaginator::currentCursorResolver(fn () => Cursor::fromEncoded(request()->query('cursor')));
});

/**
 * $count visible builds with published and changed times in different orders, ties on purpose (every 5th shares its minute, power
 * figures repeat), power with gaps, plus a quarter as many that are not public. A list the size a host holds, as in DiscoverEndpointsTest's
 * index test: every build with an owner of its own, so a plan that starts elsewhere is no cheaper. Inserted in bulk, as the projector
 * would leave them. No ANALYZE TABLE: it commits implicitly and would end RefreshDatabase's transaction.
 *
 * @return list<array{id: string, published: string, updated: string, power: ?int, title: string}> the public builds
 */
function scaleSeed(int $count): array
{
    $hidden = intdiv($count, 4);

    $make = Make::query()->create(['slug' => 'probe-scale', 'name' => 'Probe', 'country' => 'DE']);
    $model = VehicleModel::query()->create(['make_id' => $make->id, 'slug' => 'p-scale', 'name' => 'P']);
    $generation = Generation::query()->create(['model_id' => $model->id, 'slug' => 'p1-scale', 'name' => 'P1', 'year_from' => 1990, 'year_to' => null]);
    $catalog = ['make_id' => $make->id, 'model_id' => $model->id, 'generation_id' => $generation->id];
    $owners = [];
    $seeded = [];

    foreach (array_chunk(range(1, $count + $hidden), 250) as $chunk) {
        $users = [];

        foreach ($chunk as $i) {
            $user = User::factory()->make();
            $owners[$i] = $user->newUniqueId();
            $users[] = [...$user->getAttributes(), 'id' => $owners[$i], 'created_at' => now(), 'updated_at' => now()];
        }

        DB::table('users')->insert($users);
    }

    $now = now()->startOfMinute();

    foreach (array_chunk(range(1, $count + $hidden), 250) as $chunk) {
        $vehicles = [];
        $rows = [];

        foreach ($chunk as $i) {
            $owner = $owners[$i];
            $public = $i <= $count;
            $vehicle = Vehicle::factory()->published()->make(['owner_id' => $owner, ...$catalog, 'visibility' => $public ? 'public' : 'private']);
            $id = $vehicle->newUniqueId();
            $published = $now->copy()->subMinutes(intdiv($i, 5) * 5)->toDateTimeString();
            $updated = $now->copy()->subMinutes(($i * 7919) % $count)->toDateTimeString();
            $power = $i % 10 === 0 ? null : 100 + ($i * 37) % 600 - $i % 9;
            $title = [' probe p1 ', ' probex ', ' other '][$i % 3];
            $vehicles[] = [...$vehicle->getAttributes(), 'id' => $id, 'published_at' => $published, 'created_at' => $published, 'updated_at' => $updated];
            $rows[] = [
                'vehicle_id' => $id, 'owner_id' => $owner, ...$catalog, 'search_text' => 'Probe',
                'title_keys' => $title, 'search_keys' => ' probe scale w'.($i % 13).' ',
                'is_public' => $public, 'published_at' => $published, 'updated_at' => $updated, 'power_ps' => $power,
            ];

            if ($public) {
                $seeded[] = ['id' => strtolower($id), 'published' => $published, 'updated' => $updated, 'power' => $power, 'title' => $title];
            }
        }

        DB::table('vehicles')->insert($vehicles);
        DB::table('vehicle_search')->insert($rows);
    }

    return $seeded;
}

/**
 * The ids in the order each sort promises (SearchCursor::orders), from the seeded values alone.
 *
 * @param  list<array{id: string, published: string, updated: string, power: ?int, title: string}>  $seeded
 * @return list<string>
 */
function scaleReference(array $seeded, SearchSort $sort): array
{
    $key = fn (array $row): array => match ($sort) {
        SearchSort::Newest => [$row['published'], $row['updated'], $row['id']],
        SearchSort::Updated => [$row['updated'], $row['id']],
        SearchSort::Power => [$row['power'] ?? -1, $row['updated'], $row['id']],
        // "probe": 3 for a whole title word, 2 for a title word it starts, 1 otherwise.
        SearchSort::Relevance => [['probe p1' => 3, 'probex' => 2, 'other' => 1][trim($row['title'])], $row['updated'], $row['id']],
    };

    usort($seeded, fn (array $a, array $b): int => $key($b) <=> $key($a));

    return array_column($seeded, 'id');
}

/**
 * @return array<string, int>
 */
function scaleStatus(): array
{
    return collect(DB::select("SHOW SESSION STATUS WHERE Variable_name IN ('Handler_read_next', 'Handler_read_prev', 'Handler_read_rnd_next', 'Sort_rows')"))
        ->mapWithKeys(fn (object $row): array => [$row->Variable_name => (int) $row->Value])->all();
}

/**
 * One page through the service, as SearchController reads it, with its time, its queries and the rows the server read and sorted.
 *
 * @param  list<string>|null  $words
 * @return array{ids: list<string>, next: ?string, ms: float, queries: int, read: int, sorted: int, statement: array{0: string, 1: array<int, mixed>}|null}
 */
function scalePage(?array $words, SearchSort $sort, int $perPage, ?string $cursor): array
{
    CursorPaginator::currentCursorResolver(fn () => $cursor === null ? null : Cursor::fromEncoded($cursor));
    DB::flushQueryLog();
    DB::enableQueryLog();
    $before = scaleStatus();
    $start = hrtime(true);
    $page = app(TextSearch::class)->vehicles(null, $words, $perPage, null, $sort);
    $ms = (hrtime(true) - $start) / 1e6;
    $log = DB::getQueryLog();
    $queries = count($log) - 1;
    DB::disableQueryLog();
    $hits = array_values(array_filter($log, fn (array $entry): bool => str_contains($entry['query'], 'sort_at')));
    $after = scaleStatus();
    $diff = fn (string $key): int => $after[$key] - $before[$key];

    return [
        'ids' => array_values($page->getCollection()->map(fn (Vehicle $vehicle): string => strtolower($vehicle->id))->all()),
        'next' => $page->nextCursor()?->encode(),
        'ms' => round($ms, 1),
        // Without the SHOW STATUS of $before.
        'queries' => $queries,
        'read' => $diff('Handler_read_next') + $diff('Handler_read_prev') + $diff('Handler_read_rnd_next'),
        'sorted' => $diff('Sort_rows'),
        'statement' => $hits === [] ? null : [$hits[0]['query'], $hits[0]['bindings']],
    ];
}

/**
 * Walks up to $pages pages.
 *
 * @param  list<string>|null  $words
 * @return list<array{ids: list<string>, next: ?string, ms: float, queries: int, read: int, sorted: int, statement: array{0: string, 1: array<int, mixed>}|null}>
 */
function scaleWalk(?array $words, SearchSort $sort, int $perPage, int $pages): array
{
    $walked = [];
    $cursor = null;

    for ($i = 0; $i < $pages; $i++) {
        $walked[] = $page = scalePage($words, $sort, $perPage, $cursor);
        $cursor = $page['next'];

        if ($cursor === null) {
            break;
        }
    }

    return $walked;
}

/** The index each sort walks, in its column order; null for relevance. */
function scaleIndex(SearchSort $sort): ?array
{
    return match ($sort) {
        SearchSort::Newest => ['vehicle_search_is_public_published_sort_index', ['is_public', 'published_sort', 'updated_at']],
        SearchSort::Updated => ['vehicle_search_is_public_updated_at_index', ['is_public', 'updated_at']],
        SearchSort::Power => ['vehicle_search_is_public_power_sort_index', ['is_public', 'power_sort', 'updated_at']],
        SearchSort::Relevance => null,
    };
}

$sorts = [
    'newest, no text' => [null, SearchSort::Newest, true],
    'updated, no text' => [null, SearchSort::Updated, true],
    'power, no text' => [null, SearchSort::Power, true],
    'newest, text' => [['probe'], SearchSort::Newest, true],
    'power, text' => [['probe'], SearchSort::Power, true],
    // The score depends on the typed words: every match is read and the best page kept, never an index walk.
    'relevance, text' => [['probe'], SearchSort::Relevance, false],
];

it('keeps every order, and pages newest and power on an index without a filesort', function (?array $words, SearchSort $sort, bool $indexed) {
    $seeded = scaleSeed(300);
    $pages = scaleWalk($words, $sort, 20, 16);

    expect(array_merge(...array_column($pages, 'ids')))->toBe(scaleReference($seeded, $sort))
        ->and(end($pages)['next'])->toBeNull();

    if (! $indexed) {
        return;
    }

    // Engine-independent, as the Neue Builds index test: the index exists in the order of the sort's cursor, and each statement filters
    // its first column by equality and selects the bare sort column, never the old expression.
    [$name, $columns] = scaleIndex($sort);
    $index = DB::select('SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX', ['vehicle_search', $name]);
    expect(array_column($index, 'name'))->toBe($columns);

    // The plan of the first and a later page on the engine the suite runs against (tabular: MySQL 9 may default to TREE).
    $connection = DB::connection();
    $explain = $connection instanceof MySqlConnection && ! $connection->isMaria() ? 'EXPLAIN FORMAT=TRADITIONAL ' : 'EXPLAIN ';

    foreach ([$pages[0], $pages[1]] as $page) {
        [$sql, $bindings] = $page['statement'];
        $plan = DB::select($explain.$sql, $bindings);

        expect(strtolower($sql))->not->toContain('coalesce')->toContain('`vs`.`is_public` = ?')
            ->and($plan[0]->table)->toBe('vs')
            ->and(implode(' ', array_map(fn (object $row): string => (string) $row->Extra, $plan)))->not->toContain('filesort')->not->toContain('temporary');
    }
})->with($sorts);

it('pages every sort over 2,000 builds in bounded time and reads, first and 51st page', function (?array $words, SearchSort $sort, bool $indexed) {
    $seeded = scaleSeed(2000);
    $pages = scaleWalk($words, $sort, 20, 51);
    [$first, $deep] = [$pages[0], end($pages)];

    expect(array_merge(...array_column($pages, 'ids')))->toBe(array_slice(scaleReference($seeded, $sort), 0, 51 * 20));

    fwrite(STDERR, sprintf(
        "\n%-9s %-7s first %5.1f ms %2d queries read %4d sorted %4d | page 51 %5.1f ms %2d queries read %4d sorted %4d",
        $sort->value, $words === null ? 'no text' : 'text',
        $first['ms'], $first['queries'], $first['read'], $first['sorted'], $deep['ms'], $deep['queries'], $deep['read'], $deep['sorted'],
    ));

    // Measured alone on MySQL 9.6 (M2.8), 2,000 public builds and 500 private ones: indexed sorts 9–18 ms, 22 rows read per page (223 on
    // the very first page of the process), nothing sorted; relevance 16–19 ms with every match read and sorted. Before: newest and power
    // read 2,204 and 2,003 rows and sorted 2,000 and 1,000 on every page. A plan may still lean on InnoDB's background statistics right
    // after the bulk insert, so only the deep page's reads are bounded here.
    expect($first['queries'])->toBe($deep['queries'])
        ->and($first['ms'])->toBeLessThan(250.0)
        ->and($deep['ms'])->toBeLessThan(250.0);

    if ($indexed) {
        expect($deep['sorted'])->toBe(0)->and($deep['read'])->toBeLessThan(100);
    }
})->with($sorts)->group('perf');
