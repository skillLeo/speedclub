<?php

namespace App\Services\Catalog;

use App\Enums\CatalogImportKind;
use App\Enums\CatalogRowStatus;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Support\Slug;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;

/**
 * The dry run of ADM-17 (m3.3 §2): each CSV row against the catalogue as it is, without writing anything. A row names the deepest level
 * it fills: `vehicles` rows a make, a make + model or a make + model + generation (missing parents are created with it); `brands` rows a
 * brand. Entries are found by slug, the merged aliases included (a row with an old name speaks of the survivor), and never renamed by
 * an import. The apply (RunCatalogImport) plans each row again against the catalogue of that moment and runs the same Actions as a
 * manual edit, so a dry run and an apply of an unchanged catalogue agree.
 *
 * A row is {line, status: new|changed|unchanged|error, level, label, changes: {attribute: [before, after]}, creates: [levels], error:
 * {code, params}|null, data}. Row error codes (translated by the admin page): make_missing, name_missing, too_long, invalid_slug,
 * invalid_boolean, invalid_country, invalid_year, year_order, years_need_generation, generation_needs_model, invalid_category,
 * too_many_aliases, duplicate (params.line: the first row with that entry).
 *
 * @phpstan-type PlannedRow array{line: int, status: string, level: string|null, label: string, changes: array<string, array{0: mixed, 1: mixed}>, creates: list<string>, error: array{code: string, params: array<string, int|string>}|null, data: array<string, mixed>}
 */
final class CatalogImportPlanner
{
    /** Column => the header names it accepts (CatalogCsv::headerKey form). The first is the template's. */
    public const COLUMNS = [
        'vehicles' => [
            'make' => ['marke', 'make', 'hersteller'],
            'make_slug' => ['marke_slug', 'make_slug'],
            'country' => ['land', 'country'],
            'popular' => ['beliebt', 'popular'],
            'model' => ['modell', 'model'],
            'model_slug' => ['modell_slug', 'model_slug'],
            'generation' => ['generation', 'baureihe'],
            'generation_slug' => ['generation_slug', 'baureihe_slug'],
            'year_from' => ['baujahr_von', 'year_from', 'von'],
            'year_to' => ['baujahr_bis', 'year_to', 'bis'],
            'active' => ['aktiv', 'active'],
        ],
        'brands' => [
            'name' => ['marke', 'name', 'brand'],
            'slug' => ['slug'],
            'category_hint' => ['kategorie', 'category', 'category_hint'],
            'aliases' => ['aliase', 'aliases', 'alias'],
        ],
    ];

    private const ALIAS_SEPARATOR = '|';

    /**
     * @param  array{header: list<string>, rows: list<array{line: int, cells: list<string>}>}  $parsed
     * @return array{rows: list<PlannedRow>, counts: array{new: int, changed: int, unchanged: int, error: int}}
     *
     * @throws ValidationException on the header
     */
    public function plan(CatalogImportKind $kind, array $parsed): array
    {
        $columns = self::columns($kind, $parsed['header']);
        $seen = [];
        $planned = [];
        $rows = [];
        $counts = ['new' => 0, 'changed' => 0, 'unchanged' => 0, 'error' => 0];

        foreach ($parsed['rows'] as $row) {
            $result = $this->row($kind, self::values($columns, $row['cells']), $row['line'], $planned);

            if ($result['error'] === null && isset($seen[$result['data']['target']])) {
                $result = self::error($result['line'], 'duplicate', ['line' => $seen[$result['data']['target']]], $result['data']);
            }

            if ($result['error'] === null) {
                $seen[$result['data']['target']] = $result['line'];

                foreach ($result['creates'] as $level) {
                    $planned[$level.':'.$result['data']['path'][$level]] = true;
                }
            }

            $rows[] = $result;
            $counts[$result['status']] = ($counts[$result['status']] ?? 0) + 1;
        }

        return ['rows' => $rows, 'counts' => [
            'new' => $counts['new'] ?? 0,
            'changed' => $counts['changed'] ?? 0,
            'unchanged' => $counts['unchanged'] ?? 0,
            'error' => $counts['error'] ?? 0,
        ]];
    }

    /**
     * One row against the catalogue now. $planned: entries earlier rows of the same dry run would create ("make:bmw", "model:bmw/m4").
     *
     * @param  array<string, string>  $values  column => cell
     * @param  array<string, true>  $planned
     * @return PlannedRow
     */
    public function row(CatalogImportKind $kind, array $values, int $line, array $planned = []): array
    {
        return $kind === CatalogImportKind::Brands ? $this->brand($values, $line, $planned) : $this->vehicle($values, $line, $planned);
    }

    /**
     * Header cells → column per position; refuses unknown, repeated or missing columns.
     *
     * @param  list<string>  $header
     * @return array<int, string>
     *
     * @throws ValidationException
     */
    public static function columns(CatalogImportKind $kind, array $header): array
    {
        $accepted = [];

        foreach (self::COLUMNS[$kind->value] as $column => $names) {
            foreach ($names as $name) {
                $accepted[$name] = $column;
            }
        }

        $columns = [];

        foreach ($header as $position => $cell) {
            $key = CatalogCsv::headerKey($cell);

            if ($key === '') {
                continue;
            }

            $column = $accepted[$key] ?? null;

            if ($column === null) {
                throw ValidationException::withMessages(['file' => [(string) __('catalog_import.file.unknown_column', ['column' => mb_substr($cell, 0, 40)])]]);
            }

            if (in_array($column, $columns, true)) {
                throw ValidationException::withMessages(['file' => [(string) __('catalog_import.file.repeated_column', ['column' => mb_substr($cell, 0, 40)])]]);
            }

            $columns[$position] = $column;
        }

        $required = $kind === CatalogImportKind::Brands ? 'name' : 'make';

        if (! in_array($required, $columns, true)) {
            throw ValidationException::withMessages(['file' => [(string) __('catalog_import.file.missing_column', ['column' => 'Marke'])]]);
        }

        return $columns;
    }

    /**
     * @param  array<int, string>  $columns
     * @param  list<string>  $cells
     * @return array<string, string>
     */
    public static function values(array $columns, array $cells): array
    {
        $values = [];

        foreach ($columns as $position => $column) {
            $values[$column] = $cells[$position] ?? '';
        }

        return $values;
    }

    /**
     * @param  array<string, string>  $v
     * @param  array<string, true>  $planned
     * @return PlannedRow
     */
    private function vehicle(array $v, int $line, array $planned): array
    {
        $make = $v['make'] ?? '';
        $model = $v['model'] ?? '';
        $generation = $v['generation'] ?? '';
        $label = trim(implode(' ', array_filter([$make, $model, $generation], fn (string $part): bool => $part !== '')));
        $data = ['label' => $label];

        if ($make === '') {
            return self::error($line, 'make_missing', [], $data);
        }

        foreach (['make' => $make, 'model' => $model, 'generation' => $generation] as $column => $name) {
            if (mb_strlen($name) > 100) {
                return self::error($line, 'too_long', ['column' => $column, 'max' => 100], $data);
            }
        }

        if ($generation !== '' && $model === '') {
            return self::error($line, 'generation_needs_model', [], $data);
        }

        $popularInvalid = false;
        $activeInvalid = false;
        $popular = self::boolean($v['popular'] ?? '', $popularInvalid);
        $active = self::boolean($v['active'] ?? '', $activeInvalid);

        if ($popularInvalid || $activeInvalid) {
            return self::error($line, 'invalid_boolean', ['column' => $popularInvalid ? 'popular' : 'active'], $data);
        }

        $country = strtoupper($v['country'] ?? '');

        if ($country !== '' && preg_match('/^[A-Z]{2}$/', $country) !== 1) {
            return self::error($line, 'invalid_country', [], $data);
        }

        $years = [];

        foreach (['year_from', 'year_to'] as $column) {
            $cell = $v[$column] ?? '';

            if ($cell === '') {
                continue;
            }

            $last = Carbon::now(config()->string('speedclub.display_timezone'))->year + 2;

            if (preg_match('/^\d{4}$/', $cell) !== 1 || (int) $cell < EntryRules::FIRST_YEAR || (int) $cell > $last) {
                return self::error($line, 'invalid_year', ['column' => $column], $data);
            }

            $years[$column] = (int) $cell;
        }

        if ($years !== [] && $generation === '') {
            return self::error($line, 'years_need_generation', [], $data);
        }

        if (isset($years['year_from'], $years['year_to']) && $years['year_from'] > $years['year_to']) {
            return self::error($line, 'year_order', [], $data);
        }

        $slugs = ['make' => '', 'model' => '', 'generation' => ''];

        foreach (['make' => $make, 'model' => $model, 'generation' => $generation] as $level => $name) {
            if ($name === '') {
                continue;
            }

            $given = $v[$level.'_slug'] ?? '';
            $slug = $given !== '' ? $given : Slug::make($name);

            if ($slug === '' || preg_match(EntryRules::SLUG, $slug) !== 1) {
                return self::error($line, 'invalid_slug', ['column' => $level], $data);
            }

            $slugs[$level] = $slug;
        }

        $level = $generation !== '' ? 'generation' : ($model !== '' ? 'model' : 'make');
        $changes = [];
        $creates = [];
        $path = ['make' => $slugs['make'], 'model' => '', 'generation' => ''];

        $makeRow = CatalogSlugs::make($slugs['make']);

        if ($makeRow === null) {
            if (! isset($planned['make:'.$slugs['make']])) {
                $creates[] = 'make';
            }
        } else {
            $path['make'] = (string) $makeRow->slug;
            self::change($changes, 'make.country', $makeRow->getAttribute('country'), $country === '' ? null : $country, $country !== '');
            self::change($changes, 'make.is_popular', (bool) $makeRow->getAttribute('is_popular'), $popular, $popular !== null);

            if ($level === 'make') {
                self::change($changes, 'make.active', (bool) $makeRow->getAttribute('active'), $active, $active !== null);
            }
        }

        $modelRow = null;

        if ($model !== '') {
            $modelRow = $makeRow === null ? null : CatalogSlugs::model($makeRow, $slugs['model']);
            $path['model'] = $path['make'].'/'.($modelRow === null ? $slugs['model'] : (string) $modelRow->getAttribute('slug'));

            if ($modelRow === null) {
                if (! isset($planned['model:'.$path['model']])) {
                    $creates[] = 'model';
                }
            } elseif ($level === 'model') {
                self::change($changes, 'model.active', (bool) $modelRow->getAttribute('active'), $active, $active !== null);
            }
        }

        if ($generation !== '') {
            $generationRow = $modelRow === null ? null : CatalogSlugs::generation($modelRow, $slugs['generation']);
            $path['generation'] = $path['model'].'/'.($generationRow === null ? $slugs['generation'] : (string) $generationRow->getAttribute('slug'));

            if ($generationRow === null) {
                if (! isset($planned['generation:'.$path['generation']])) {
                    $creates[] = 'generation';
                }
            } else {
                foreach ($years as $column => $year) {
                    self::change($changes, 'generation.'.$column, $generationRow->getAttribute($column), $year, true);
                }

                self::change($changes, 'generation.active', (bool) $generationRow->getAttribute('active'), $active, $active !== null);
            }
        }

        $data += [
            'target' => $level.':'.$path[$level],
            'path' => $path,
            'level' => $level,
            'names' => ['make' => $make, 'model' => $model, 'generation' => $generation],
            'slugs' => $slugs,
            'country' => $country === '' ? null : $country,
            'popular' => $popular,
            'active' => $active,
            'years' => $years,
        ];

        return self::result($line, $level, $label, $changes, $creates, $data);
    }

    /**
     * @param  array<string, string>  $v
     * @param  array<string, true>  $planned
     * @return PlannedRow
     */
    private function brand(array $v, int $line, array $planned): array
    {
        $name = $v['name'] ?? '';
        $data = ['label' => $name];

        if ($name === '') {
            return self::error($line, 'name_missing', [], $data);
        }

        if (mb_strlen($name) > 120) {
            return self::error($line, 'too_long', ['column' => 'name', 'max' => 120], $data);
        }

        $given = $v['slug'] ?? '';
        $slug = $given !== '' ? $given : Slug::make($name);

        if ($slug === '' || preg_match(EntryRules::SLUG, $slug) !== 1) {
            return self::error($line, 'invalid_slug', ['column' => 'slug'], $data);
        }

        $hint = $v['category_hint'] ?? '';

        if ($hint !== '' && ! ModCategory::query()->where('key', $hint)->exists()) {
            return self::error($line, 'invalid_category', [], $data);
        }

        $aliases = array_values(array_unique(array_filter(array_map(trim(...), explode(self::ALIAS_SEPARATOR, $v['aliases'] ?? '')), fn (string $alias): bool => $alias !== '')));

        if (count($aliases) > 20 || array_filter($aliases, fn (string $alias): bool => mb_strlen($alias) > 120) !== []) {
            return self::error($line, 'too_many_aliases', ['max' => 20], $data);
        }

        $changes = [];
        $creates = [];
        $brand = CatalogSlugs::brand($slug);
        $merged = $aliases;

        if ($brand === null) {
            if (! isset($planned['brand:'.$slug])) {
                $creates[] = 'brand';
            }
        } else {
            $slug = (string) $brand->getAttribute('slug');
            self::change($changes, 'brand.category_hint', $brand->getAttribute('category_hint'), $hint === '' ? null : $hint, $hint !== '');
            $current = is_array($brand->aliases) ? array_values(array_filter($brand->aliases, is_string(...))) : [];
            $lower = array_map(mb_strtolower(...), [...$current, (string) $brand->getAttribute('name')]);
            $added = array_values(array_filter($aliases, fn (string $alias): bool => ! in_array(mb_strtolower($alias), $lower, true)));
            $merged = [...$current, ...$added];
            self::change($changes, 'brand.aliases', $current, $merged, $added !== []);
        }

        $data += [
            'target' => 'brand:'.$slug,
            'path' => ['brand' => $slug],
            'level' => 'brand',
            'name' => $name,
            'slug' => $slug,
            'category_hint' => $hint === '' ? null : $hint,
            'aliases' => $merged,
        ];

        return self::result($line, 'brand', $name, $changes, $creates, $data);
    }

    /**
     * "ja", "nein", "x", "1", "0", "true", "false", "yes", "no"; empty is null (no change). $invalid says the cell is none of these.
     */
    private static function boolean(string $cell, bool &$invalid): ?bool
    {
        $cell = mb_strtolower(trim($cell));
        $value = match ($cell) {
            'ja', 'j', 'x', '1', 'true', 'wahr', 'yes', 'y' => true,
            'nein', 'n', '0', 'false', 'falsch', 'no' => false,
            default => null,
        };
        $invalid = $value === null && $cell !== '';

        return $value;
    }

    /**
     * @param  array<string, array{0: mixed, 1: mixed}>  $changes
     */
    private static function change(array &$changes, string $attribute, mixed $before, mixed $after, bool $given): void
    {
        if ($given && json_encode($before) !== json_encode($after)) {
            $changes[$attribute] = [$before, $after];
        }
    }

    /**
     * @param  array<string, array{0: mixed, 1: mixed}>  $changes
     * @param  list<string>  $creates
     * @param  array<string, mixed>  $data
     * @return PlannedRow
     */
    private static function result(int $line, string $level, string $label, array $changes, array $creates, array $data): array
    {
        $status = $creates !== [] ? CatalogRowStatus::New : ($changes !== [] ? CatalogRowStatus::Changed : CatalogRowStatus::Unchanged);

        return ['line' => $line, 'status' => $status->value, 'level' => $level, 'label' => $label, 'changes' => $changes, 'creates' => $creates, 'error' => null, 'data' => $data];
    }

    /**
     * @param  array<string, int|string>  $params
     * @param  array<string, mixed>  $data
     * @return PlannedRow
     */
    private static function error(int $line, string $code, array $params, array $data): array
    {
        return [
            'line' => $line,
            'status' => CatalogRowStatus::Error->value,
            'level' => null,
            'label' => (string) ($data['label'] ?? ''),
            'changes' => [],
            'creates' => [],
            'error' => ['code' => $code, 'params' => $params],
            'data' => $data,
        ];
    }
}
