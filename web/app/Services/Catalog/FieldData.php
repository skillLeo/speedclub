<?php

namespace App\Services\Catalog;

use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Modification;
use App\Services\Garage\ModFields;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Which modifications hold data in a schema field (m3.3 §1, ADM-15), soft-deleted ones included, as they can come back. A changed field
 * definition is checked against every stored modification of the category with the member's own validator (ModFields), so "narrowing"
 * means exactly what the garage would refuse on the member's next save: a value outside the new min/max/step, an option that is gone, a
 * text that no longer matches the pattern, or a required field the modification does not have.
 */
final class FieldData
{
    private const CHUNK = 500;

    /** The keys FieldRules accepts; anything else never reaches a JSON path here. */
    private const KEY_PATTERN = '/^[a-z][a-z0-9_]*$/';

    private const COUNTS_PER_QUERY = 24;

    /** One SUM per field over the category's modifications; a stored JSON null is no data (JSON_TYPE 'NULL'), a missing key neither. */
    private const COUNTS_SQL = <<<'SQL'
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c0,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c1,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c2,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c3,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c4,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c5,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c6,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c7,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c8,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c9,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c10,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c11,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c12,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c13,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c14,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c15,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c16,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c17,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c18,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c19,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c20,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c21,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c22,
        COALESCE(SUM(COALESCE(JSON_TYPE(JSON_EXTRACT(fields, ?)), 'NULL') <> 'NULL'), 0) AS c23
        SQL;

    public function __construct(private readonly ModFields $fields) {}

    public static function count(ModCategoryField $field): int
    {
        $key = (string) $field->getAttribute('key');

        return self::counts((int) $field->getAttribute('category_id'), [$key])[$key] ?? 0;
    }

    /**
     * How many modifications of the category hold a value in each of $keys, in one aggregate over the category (SF-8 of the M3.3
     * review: ADM-15 used to scan the category once per field). A stored JSON null is no data (N-6): JSON_TYPE is 'NULL' for it and SQL
     * NULL for a missing key; MySQL 8 and MariaDB 10.6 both have it.
     *
     * @param  list<string>  $keys
     * @return array<string, int>
     */
    public static function counts(int $categoryId, array $keys): array
    {
        $keys = array_values(array_unique(array_filter($keys, fn (string $key): bool => preg_match(self::KEY_PATTERN, $key) === 1)));
        $counts = [];

        // COUNTS_SQL takes COUNTS_PER_QUERY paths; a category with more fields needs one more query per further 24. Unused slots get a
        // path no field has. Every key reaches the SQL as a binding.
        foreach (array_chunk($keys, self::COUNTS_PER_QUERY) as $chunk) {
            $paths = array_pad(array_map(fn (string $key): string => '$."'.$key.'"', $chunk), self::COUNTS_PER_QUERY, '$."-"');

            $row = (array) Modification::withTrashed()->toBase()
                ->selectRaw(self::COUNTS_SQL, $paths)
                ->where('category_id', $categoryId)
                ->first();

            foreach ($chunk as $index => $key) {
                $counts[$key] = (int) ($row["c$index"] ?? 0);
            }
        }

        return $counts;
    }

    /**
     * How many stored modifications the definition $candidate (unsaved, the field as it would be) would refuse.
     */
    public function violations(ModCategoryField $candidate): int
    {
        $key = (string) $candidate->getAttribute('key');
        $category = new ModCategory;
        $category->setRelation('fields', new Collection([$candidate]));
        $affected = 0;

        Modification::withTrashed()
            ->where('category_id', $candidate->getAttribute('category_id'))
            ->when(! $candidate->required, fn ($query) => $query->whereNotNull('fields->'.$key))
            ->select(['id', 'fields'])
            ->chunkById(self::CHUNK, function ($mods) use ($key, $category, &$affected): void {
                foreach ($mods as $mod) {
                    /** @var array<string, mixed> $stored */
                    $stored = $mod->getAttribute('fields') ?? [];

                    try {
                        $this->fields->validated($category, array_key_exists($key, $stored) ? [$key => $stored[$key]] : []);
                    } catch (ValidationException) {
                        $affected++;
                    }
                }
            });

        return $affected;
    }
}
