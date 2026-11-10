<?php

namespace App\Services\Discover;

use App\Enums\SearchSort;

/**
 * Binds a cursor to the list it came from (ADR-115, m2.3 contract §1). Each sort pages on its own columns, and every list carries the
 * column `f`: a signature of the text, the filters and the sort, the same value on every row. A cursor of another sort has other
 * columns, one of another text or filter set another `f`; both answer 422 (ValidCursor) instead of a page of a different list.
 */
final class SearchCursor
{
    public const COLUMN = 'f';

    /**
     * Order columns of each sort, after `f`. All are never null: power reads -1 for a build without a figure, newest falls back to the
     * last change.
     *
     * @return array<string, 'asc'|'desc'>
     */
    public static function orders(SearchSort $sort): array
    {
        return match ($sort) {
            SearchSort::Relevance => ['relevance' => 'desc', 'sort_at' => 'desc', 'id' => 'desc'],
            // Ties by the last change, then the id, as every sort (m2.3 handover §2; M2.3 review #20).
            SearchSort::Newest => ['published_sort' => 'desc', 'sort_at' => 'desc', 'id' => 'desc'],
            SearchSort::Updated => ['sort_at' => 'desc', 'id' => 'desc'],
            SearchSort::Power => ['power_sort' => 'desc', 'sort_at' => 'desc', 'id' => 'desc'],
        };
    }

    /**
     * @return list<string>
     */
    public static function columns(SearchSort $sort): array
    {
        return [self::COLUMN, ...array_keys(self::orders($sort))];
    }

    /**
     * 16 hex digits of an HMAC under the app key: a client cannot make a cursor fit another list by editing it.
     *
     * @param  list<string>|null  $words
     */
    public static function signature(string $list, ?array $words, SearchFilters $filters, SearchSort $sort): string
    {
        $payload = json_encode([$list, $words, $filters->canonical(), $sort->value], JSON_THROW_ON_ERROR);

        return substr(hash_hmac('sha256', $payload, (string) config('app.key')), 0, 16);
    }
}
