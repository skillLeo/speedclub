<?php

namespace App\Services\Catalog;

use App\Models\Brand;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ADM-16 "Normalisieren": suggestions, never changes. Brands whose names (or aliases) are equal after folding case, diacritics,
 * punctuation and spaces ("Akrapovic", "AKRAPOVIČ", "Akra-povic") are one group; the suggested survivor is the spelling with diacritics
 * (the more exact one), then the most used, then the oldest. Merged brands are left out. Applying a suggestion is a merge
 * (MergeCatalogEntries, level brand).
 */
final class BrandNormaliser
{
    public static function fold(string $name): string
    {
        return (string) preg_replace('/[^a-z0-9]/', '', Str::lower(Str::ascii(strtr($name, ['ß' => 'ss', 'ẞ' => 'ss', 'æ' => 'ae', 'ø' => 'o']))));
    }

    /**
     * @return list<array{key: string, survivor: array{id: int, name: string, slug: string, usage: int}, duplicates: list<array{id: int, name: string, slug: string, usage: int}>}>
     */
    public function suggestions(): array
    {
        $usage = DB::table('modifications')->whereNotNull('brand_id')->groupBy('brand_id')->pluck(DB::raw('COUNT(*)'), 'brand_id')->all();
        $groups = [];

        foreach (Brand::query()->whereNull('merged_into_id')->orderBy('id')->get(['id', 'name', 'slug', 'aliases']) as $brand) {
            $row = [
                'id' => (int) $brand->getKey(),
                'name' => (string) $brand->getAttribute('name'),
                'slug' => (string) $brand->getAttribute('slug'),
                'usage' => (int) ($usage[$brand->getKey()] ?? 0),
            ];
            $key = self::fold($row['name']);

            if ($key !== '') {
                $groups[$key][$row['id']] = $row;
            }
        }

        // A brand whose alias folds to another brand's name joins that group.
        foreach (Brand::query()->whereNull('merged_into_id')->whereNotNull('aliases')->get(['id', 'name', 'slug', 'aliases']) as $brand) {
            foreach (is_array($brand->aliases) ? $brand->aliases : [] as $alias) {
                $key = self::fold($alias);
                $own = self::fold((string) $brand->getAttribute('name'));

                if ($key !== '' && $key !== $own && isset($groups[$key]) && isset($groups[$own][(int) $brand->getKey()])) {
                    $groups[$key][(int) $brand->getKey()] = $groups[$own][(int) $brand->getKey()];
                    unset($groups[$own][(int) $brand->getKey()]);
                }
            }
        }

        $suggestions = [];

        foreach ($groups as $key => $rows) {
            if (count($rows) < 2) {
                continue;
            }

            $rows = array_values($rows);
            usort($rows, fn (array $a, array $b): int => [self::exactness($b['name']), $b['usage'], -$b['id']] <=> [self::exactness($a['name']), $a['usage'], -$a['id']]);
            $suggestions[] = ['key' => (string) $key, 'survivor' => $rows[0], 'duplicates' => array_slice($rows, 1)];
        }

        usort($suggestions, fn (array $a, array $b): int => strcmp($a['survivor']['name'], $b['survivor']['name']));

        return $suggestions;
    }

    /** Non-ASCII letters and mixed case count as the more careful spelling. */
    private static function exactness(string $name): int
    {
        return (preg_match('/[^\x00-\x7F]/', $name) === 1 ? 2 : 0) + ($name !== Str::upper($name) && $name !== Str::lower($name) ? 1 : 0);
    }
}
