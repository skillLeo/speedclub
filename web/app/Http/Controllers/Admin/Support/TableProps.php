<?php

namespace App\Http\Controllers\Admin\Support;

use App\Actions\Admin\Overview\SavedViews;
use App\Models\Staff;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * Props of a server-driven DataTable (contract §0 "Tables"): {rows: {data, meta}, query: {filter, sort, per_page}, views}.
 * Filters and sorts are whitelisted on the QueryBuilder by the caller; this only pages, maps and echoes the query.
 */
final class TableProps
{
    public const PER_PAGE = [25, 50, 100];

    /**
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  QueryBuilder<TModel>  $query
     * @param  Closure(list<TModel>): list<array<string, mixed>>  $map  maps one page of models at once, so lookups can be batched
     * @return array{rows: array{data: list<array<string, mixed>>, meta: array<string, int|null>}, query: array<string, mixed>, views: list<array<string, mixed>>}
     */
    public static function make(QueryBuilder $query, Request $request, string $table, Staff $staff, Closure $map, string $defaultSort): array
    {
        $perPage = self::perPage($request);

        /** @var LengthAwarePaginator<int, TModel> $page */
        $page = $query->paginate($perPage)->withQueryString();

        /** @var list<TModel> $items */
        $items = array_values($page->items());

        return [
            'rows' => [
                'data' => $map($items),
                'meta' => [
                    'current_page' => $page->currentPage(),
                    'last_page' => $page->lastPage(),
                    'per_page' => $page->perPage(),
                    'total' => $page->total(),
                    'from' => $page->firstItem(),
                    'to' => $page->lastItem(),
                ],
            ],
            'query' => [
                'filter' => (object) self::filters($request),
                'sort' => is_string($request->query('sort')) ? $request->query('sort') : $defaultSort,
                'per_page' => $perPage,
            ],
            'views' => SavedViews::for($staff, $table),
        ];
    }

    public static function perPage(Request $request): int
    {
        $perPage = (int) $request->query('per_page', '25');

        return in_array($perPage, self::PER_PAGE, true) ? $perPage : 25;
    }

    /**
     * @return array<string, string>
     */
    public static function filters(Request $request): array
    {
        $filter = $request->query('filter');

        return is_array($filter)
            ? array_filter(array_map(fn (mixed $value): string => is_scalar($value) ? (string) $value : '', $filter), fn (string $value): bool => $value !== '')
            : [];
    }
}
