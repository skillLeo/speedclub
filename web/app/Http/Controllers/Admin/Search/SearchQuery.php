<?php

namespace App\Http\Controllers\Admin\Search;

use App\Http\Controllers\Admin\Support\SearchData;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * The search term of ADM-07 and the palette: trimmed, at most 120 characters (contract §1.7). Longer input is cut, not refused,
 * because the field is typed into live.
 */
final class SearchQuery
{
    public static function from(Request $request): string
    {
        $q = $request->query('q');

        return is_string($q) ? Str::limit(trim($q), SearchData::MAX_QUERY, '') : '';
    }
}
