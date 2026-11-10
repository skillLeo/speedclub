<?php

namespace App\Services\Catalog;

use App\Enums\CatalogEvent;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\ModCategorySchemaVersion;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Carbon\CarbonInterface;

/**
 * Versioned field schemas (m3.3 §1, ADM-15): every change to a category's fields writes the whole schema after it as a new version and
 * one `catalog.schema_changed` event with the diff (the fields that changed, before and after). The first change also writes version 1,
 * the state before any admin change (no staff, no reason), so the history always starts from what the seeder wrote.
 * Called inside the Action's transaction, with the category row locked.
 *
 * @phpstan-type FieldSnapshot array<string, mixed>
 */
final class SchemaVersions
{
    /**
     * The fields of the category as stored, archived ones included, in their order.
     *
     * @return list<FieldSnapshot>
     */
    public static function snapshot(ModCategory $category): array
    {
        return array_values(ModCategoryField::query()
            ->where('category_id', $category->getKey())
            ->orderBy('sort')
            ->orderBy('id')
            ->get()
            ->map(fn (ModCategoryField $field): array => self::field($field))
            ->all());
    }

    /**
     * @return FieldSnapshot
     */
    public static function field(ModCategoryField $field): array
    {
        $archived = $field->archived_at;

        return [
            'id' => (int) $field->getKey(),
            'key' => (string) $field->getAttribute('key'),
            'label' => $field->getTranslations('label'),
            'type' => $field->type->value,
            'unit' => $field->getAttribute('unit'),
            'min' => $field->min,
            'max' => $field->max,
            'step' => $field->step,
            'options' => $field->options,
            'required' => (bool) $field->required,
            'searchable' => (bool) $field->getAttribute('searchable'),
            'facet' => (bool) $field->getAttribute('facet'),
            'sort' => (int) $field->getAttribute('sort'),
            'archived_at' => $archived instanceof CarbonInterface ? $archived->toIso8601String() : null,
        ];
    }

    /**
     * Writes the version after a change and its audit event. $before is the snapshot taken before the change.
     *
     * @param  list<FieldSnapshot>  $before
     */
    public static function record(ModCategory $category, Staff $staff, string $reason, array $before, string $change): ModCategorySchemaVersion
    {
        $after = self::snapshot($category);
        $latest = ModCategorySchemaVersion::query()->where('category_id', $category->getKey())->max('version');
        $latest = is_numeric($latest) ? (int) $latest : 0;

        if ($latest === 0) {
            self::write($category, 1, $before, null, null);
            $latest = 1;
        }

        $version = self::write($category, $latest + 1, $after, $staff, $reason);
        [$was, $is] = self::diff($before, $after);

        Audit::record(CatalogEvent::SchemaChanged->value, $category,
            before: ['version' => $latest, 'fields' => $was],
            after: ['version' => $latest + 1, 'change' => $change, 'fields' => $is],
            reason: $reason, actor: $staff);

        return $version;
    }

    /**
     * The fields that differ, keyed by field id: [before, after]; a field missing on one side is null there.
     *
     * @param  list<FieldSnapshot>  $before
     * @param  list<FieldSnapshot>  $after
     * @return array{0: array<string, FieldSnapshot|null>, 1: array<string, FieldSnapshot|null>}
     */
    public static function diff(array $before, array $after): array
    {
        $old = [];
        $new = [];

        foreach ($before as $field) {
            $old[(string) $field['id']] = $field;
        }

        foreach ($after as $field) {
            $new[(string) $field['id']] = $field;
        }

        $was = [];
        $is = [];

        foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $id) {
            $a = $old[$id] ?? null;
            $b = $new[$id] ?? null;

            if ($a === null || $b === null) {
                $was[$id] = $a;
                $is[$id] = $b;

                continue;
            }

            $changed = array_keys(array_filter($b, fn (mixed $value, string $key): bool => json_encode($value) !== json_encode($a[$key] ?? null), ARRAY_FILTER_USE_BOTH));

            if ($changed !== []) {
                $was[$id] = array_intersect_key($a, array_flip(['key', ...$changed]));
                $is[$id] = array_intersect_key($b, array_flip(['key', ...$changed]));
            }
        }

        return [$was, $is];
    }

    /**
     * @param  list<FieldSnapshot>  $schema
     */
    private static function write(ModCategory $category, int $version, array $schema, ?Staff $staff, ?string $reason): ModCategorySchemaVersion
    {
        $row = new ModCategorySchemaVersion;
        $row->forceFill([
            'category_id' => $category->getKey(),
            'version' => $version,
            'schema' => $schema,
            'staff_id' => $staff?->getKey(),
            'reason' => $reason,
            'created_at' => now(),
        ])->save();

        return $row;
    }
}
