<?php

namespace App\Http\Controllers\Admin\Badges;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Models\Badge;
use App\Models\UserBadge;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM "Abzeichen" list query (m5.9d contract §2): every badge in admin order (sort, then key) with how many members earned it.
 * Whitelisted filters: q (key or German/English name, contains), category, tier, hidden (yes|no), active (yes|no); sorts: sort, key,
 * earned. The key is the tie-breaker.
 */
final class BadgeListQuery
{
    public const TABLE = 'badges';

    public const DEFAULT_SORT = 'sort';

    /**
     * @return QueryBuilder<Badge>
     */
    public static function build(Request $request): QueryBuilder
    {
        $base = Badge::query()->select('badges.*')->addSelect([
            'earned' => UserBadge::query()->selectRaw('count(*)')->whereColumn('user_badges.badge_key', 'badges.key'),
        ]);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = trim(is_string($value) ? $value : '');
                    if ($text === '') {
                        return;
                    }
                    $like = '%'.addcslashes(mb_strtolower($text), '%_\\').'%';
                    $q->where(fn (Builder $w) => $w->where('badges.key', 'like', $like)->orWhereRaw('lower(badges.name_de) like ?', [$like])->orWhereRaw('lower(badges.name_en) like ?', [$like]));
                })->delimiter("\u{1}"),
                AllowedFilter::callback('category', fn (Builder $q, mixed $value) => BadgeCategory::tryFrom(is_string($value) ? $value : '') === null ? null : $q->where('badges.category', $value))->delimiter("\u{1}"),
                AllowedFilter::callback('tier', fn (Builder $q, mixed $value) => BadgeTier::tryFrom(is_string($value) ? $value : '') === null ? null : $q->where('badges.tier', $value))->delimiter("\u{1}"),
                AllowedFilter::callback('hidden', fn (Builder $q, mixed $value) => self::flag($q, 'hidden', $value))->delimiter("\u{1}"),
                AllowedFilter::callback('active', fn (Builder $q, mixed $value) => self::flag($q, 'active', $value))->delimiter("\u{1}"),
            )
            ->allowedSorts(
                AllowedSort::field('sort', 'badges.sort'),
                AllowedSort::field('key', 'badges.key'),
                AllowedSort::callback('earned', fn (Builder $q, bool $descending) => $q->orderBy('earned', $descending ? 'desc' : 'asc')),
            )
            ->defaultSort(self::DEFAULT_SORT);

        $query->getEloquentBuilder()->orderBy('badges.key');

        return $query;
    }

    /**
     * @param  list<Badge>  $badges
     * @return list<array<string, mixed>>
     */
    public static function rows(array $badges): array
    {
        return array_map(fn (Badge $badge): array => [
            'key' => $badge->key,
            'name' => $badge->name(),
            'category' => $badge->category->value,
            'tier' => $badge->tier->value,
            'hidden' => $badge->hidden,
            'active' => $badge->active,
            'sort' => $badge->sort,
            'earned' => (int) $badge->getAttribute('earned'),
            'rule' => $badge->rule_json,
        ], $badges);
    }

    /**
     * @template TModel of Model
     *
     * @param  Builder<TModel>  $q
     */
    private static function flag(Builder $q, string $column, mixed $value): void
    {
        match ($value) {
            'yes' => $q->where("badges.$column", true),
            'no' => $q->where("badges.$column", false),
            default => null,
        };
    }
}
