<?php

namespace App\Services\Discover;

use App\Services\Search\SearchTerms;
use Illuminate\Database\Query\Builder;

/**
 * Who a typed name finds (DISC-02 members, PROF-04 search): every word from SearchTerms::nameWords must start the username, a part of
 * it after "." or "_", or a word of the display name. Case-insensitive through the collation. No words at all finds nobody.
 *
 * The SQL is fixed, so nothing in it comes from a variable: the query reads users as `u` (TextSearch, Connections).
 */
final class MemberNameFilter
{
    private const ESCAPE = " ESCAPE '!'";

    /**
     * An Eloquent query passes its base query (getQuery()), which this changes in place.
     *
     * $withCity also lets a word start a word of the city (DISC-02 members, M2.3); PROF-04 lists search names only.
     *
     * @param  list<string>  $words
     */
    public static function apply(Builder $query, array $words, bool $withCity = false): Builder
    {
        if ($words === []) {
            return $query->whereRaw('1 = 0');
        }

        foreach ($words as $word) {
            $escaped = SearchTerms::escapeLike($word);

            $query->where(function (Builder $match) use ($escaped, $withCity): void {
                $match->whereRaw('u.username LIKE ?'.self::ESCAPE, ["$escaped%"])
                    ->orWhereRaw('u.username LIKE ?'.self::ESCAPE, ["%.$escaped%"])
                    ->orWhereRaw('u.username LIKE ?'.self::ESCAPE, ["%!_$escaped%"])
                    ->orWhereRaw('u.display_name LIKE ?'.self::ESCAPE, ["$escaped%"])
                    ->orWhereRaw('u.display_name LIKE ?'.self::ESCAPE, ["% $escaped%"])
                    ->orWhereRaw('u.display_name LIKE ?'.self::ESCAPE, ["%-$escaped%"]);

                if ($withCity) {
                    $match->orWhereRaw('u.city LIKE ?'.self::ESCAPE, ["$escaped%"])
                        ->orWhereRaw('u.city LIKE ?'.self::ESCAPE, ["% $escaped%"])
                        ->orWhereRaw('u.city LIKE ?'.self::ESCAPE, ["%-$escaped%"]);
                }
            });
        }

        return $query;
    }
}
