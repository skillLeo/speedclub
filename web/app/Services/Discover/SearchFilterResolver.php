<?php

namespace App\Services\Discover;

use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\VehicleModel;
use App\Services\Catalog\CatalogSlugs;
use Closure;

/**
 * Turns the filter parameters of DISC-02 (already checked for type and range by FilterRules) into SearchFilters, looking every slug up
 * in the catalogue. Unknown slugs come back as errors on their field, in the request's language:
 *
 * - `make`: a make slug ("bmw").
 * - `model`: a model slug of that make ("m4"). Model slugs are not unique across makes ("gt" is a Ford, a Lamborghini and more), so
 *   without `make` only the composite key of DISC-04 ("bmw--m4") or a slug that only one make has is accepted.
 * - `generation`: a generation slug of that model ("g82").
 * - `wheel_brand[]`, `suspension_brand[]`, `exhaust_brand[]`: brand slugs; a merged brand counts as the brand it was merged into.
 * - `suspension_type[]`, `mod_category[]`: the option values of the suspension type field and the active category keys, both read from
 *   the admin-editable schema (ADM-15).
 */
final class SearchFilterResolver
{
    public const LIST_KEYS = ['drivetrain', 'gearbox', 'fuel', 'wheel_diameter', 'wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand', 'mod_category'];

    /**
     * @param  array<string, mixed>  $input
     * @return array{filters: SearchFilters, errors: array<string, string>}
     */
    public function resolve(array $input): array
    {
        $errors = [];
        $make = null;
        $model = null;
        $generation = null;
        $makeSlug = self::text($input['make'] ?? null);
        $modelSlug = self::text($input['model'] ?? null);
        $generationSlug = self::text($input['generation'] ?? null);

        if ($makeSlug !== null) {
            $make = CatalogSlugs::make($makeSlug);

            if ($make === null) {
                $errors['make'] = (string) __('discover.filters.unknown_make');
            }
        }

        if ($modelSlug !== null && ! isset($errors['make'])) {
            [$make, $model, $error] = $this->model($make, $modelSlug);

            if ($error !== null) {
                $errors['model'] = $error;
            }
        }

        if ($generationSlug !== null && ! isset($errors['make']) && ! isset($errors['model'])) {
            if ($model === null) {
                $errors['generation'] = (string) __('discover.filters.generation_needs_model');
            } else {
                $generation = CatalogSlugs::generation($model, $generationSlug);

                if ($generation === null) {
                    $errors['generation'] = (string) __('discover.filters.unknown_generation');
                }
            }
        }

        $yearMin = self::integer($input['year_min'] ?? null);
        $yearMax = self::integer($input['year_max'] ?? null);
        $powerMin = self::integer($input['power_min'] ?? null);
        $powerMax = self::integer($input['power_max'] ?? null);

        if ($yearMin !== null && $yearMax !== null && $yearMin > $yearMax) {
            $errors['year_max'] = (string) __('discover.filters.range_order');
        }

        if ($powerMin !== null && $powerMax !== null && $powerMin > $powerMax) {
            $errors['power_max'] = (string) __('discover.filters.range_order');
        }

        $brands = [];

        foreach (['wheel_brand', 'suspension_brand', 'exhaust_brand'] as $key) {
            $slugs = self::list($input[$key] ?? null);
            $found = $this->brands($slugs);

            if (count($found) !== count($slugs)) {
                $errors[$key] = (string) __('discover.filters.unknown_brand');
            }

            $brands[$key] = $found;
        }

        $suspensionTypes = self::list($input['suspension_type'] ?? null);

        if (array_diff($suspensionTypes, self::suspensionTypes()) !== []) {
            $errors['suspension_type'] = (string) __('discover.filters.unknown_value');
        }

        $categoryKeys = self::list($input['mod_category'] ?? null);
        $bits = self::categoryBits();
        $categories = [];

        foreach ($categoryKeys as $key) {
            if (isset($bits[$key])) {
                $categories[$key] = $bits[$key];
            } else {
                $errors['mod_category'] = (string) __('discover.filters.unknown_value');
            }
        }

        $diameters = array_values(array_unique(array_map(
            fn (string $value): string => self::diameter((float) $value),
            self::list($input['wheel_diameter'] ?? null),
        )));
        usort($diameters, fn (string $a, string $b): int => (float) $a <=> (float) $b);

        return ['errors' => $errors, 'filters' => new SearchFilters(
            make: $make,
            model: $model,
            generation: $generation,
            yearMin: $yearMin,
            yearMax: $yearMax,
            powerMin: $powerMin,
            powerMax: $powerMax,
            drivetrain: self::list($input['drivetrain'] ?? null),
            gearbox: self::list($input['gearbox'] ?? null),
            fuel: self::list($input['fuel'] ?? null),
            wheelDiameters: $diameters,
            wheelBrands: $brands['wheel_brand'],
            suspensionTypes: $suspensionTypes,
            suspensionBrands: $brands['suspension_brand'],
            exhaustBrands: $brands['exhaust_brand'],
            modCategories: $categories,
        )];
    }

    /**
     * "19", "19.5": the value of a wheel_diameter facet row.
     */
    public static function diameter(float $inches): string
    {
        return rtrim(rtrim(number_format(round($inches * 2) / 2, 1, '.', ''), '0'), '.');
    }

    /**
     * Option values of the suspension type field, in the schema's order.
     *
     * @return list<string>
     */
    public static function suspensionTypes(): array
    {
        return array_column(self::suspensionTypeOptions(), 'value');
    }

    /**
     * @return list<array{value: string, label: array<string, string>}>
     */
    public static function suspensionTypeOptions(): array
    {
        return self::memo('suspension_types', self::readSuspensionTypeOptions(...));
    }

    /**
     * @return list<array{value: string, label: array<string, string>}>
     */
    private static function readSuspensionTypeOptions(): array
    {
        $field = ModCategoryField::query()
            ->whereHas('category', fn ($category) => $category->where('key', 'suspension'))
            ->where('key', 'type')
            ->first();

        /** @var list<array{value: string, label: array<string, string>}> $options */
        $options = array_values(array_filter(
            (array) ($field?->getAttribute('options') ?? []),
            fn (mixed $option): bool => is_array($option) && is_string($option['value'] ?? null),
        ));

        return $options;
    }

    /**
     * Active categories by key, with their bit of vehicle_search.mod_category_mask (1 << (sort - 1), VehicleSearchProjector).
     *
     * @return array<string, int>
     */
    public static function categoryBits(): array
    {
        return self::memo('category_bits', self::readCategoryBits(...));
    }

    /**
     * @return array<string, int>
     */
    private static function readCategoryBits(): array
    {
        $bits = [];

        foreach (ModCategory::query()->where('active', true)->orderBy('sort')->get(['key', 'sort']) as $category) {
            $sort = (int) $category->getAttribute('sort');

            if ($sort >= 1 && $sort <= 63) {
                $bits[$category->key] = 1 << ($sort - 1);
            }
        }

        return $bits;
    }

    /**
     * Once per request (M2.3 review #9): GET discover resolves every collection, and each asked the schema again. Kept on the request, as
     * FeatureFlags does, so a queue worker or the next request reads an edited schema.
     *
     * @template T of array
     *
     * @param  Closure(): T  $read
     * @return T
     */
    private static function memo(string $key, Closure $read): array
    {
        $attributes = request()->attributes;
        $name = 'speedclub.discover.'.$key;

        if (! $attributes->has($name)) {
            $attributes->set($name, $read());
        }

        /** @var T $value */
        $value = $attributes->get($name);

        return $value;
    }

    /**
     * @return array{0: Make|null, 1: VehicleModel|null, 2: string|null}
     */
    private function model(?Make $make, string $slug): array
    {
        if ($make !== null) {
            $model = CatalogSlugs::model($make, $slug);

            return [$make, $model, $model === null ? (string) __('discover.filters.unknown_model') : null];
        }

        if (str_contains($slug, '--')) {
            $model = ModelKey::find($slug);

            return [$model?->make, $model, $model === null ? (string) __('discover.filters.unknown_model') : null];
        }

        // Merged rows keep their slugs as aliases: several rows may stand for one survivor.
        $models = VehicleModel::query()->where('slug', $slug)->limit(10)->get()
            ->map(fn (VehicleModel $row): VehicleModel => CatalogSlugs::survivor($row))
            ->unique(fn (VehicleModel $row): int => (int) $row->getKey())
            ->values()
            ->each(fn (VehicleModel $row) => $row->loadMissing('make'));

        return match ($models->count()) {
            0 => [null, null, (string) __('discover.filters.unknown_model')],
            1 => [$models->first()?->make, $models->first(), null],
            default => [null, null, (string) __('discover.filters.model_needs_make')],
        };
    }

    /**
     * @param  list<string>  $slugs
     * @return array<string, int> slug => id of the brand it stands for
     */
    private function brands(array $slugs): array
    {
        if ($slugs === []) {
            return [];
        }

        $found = [];

        foreach (Brand::query()->whereIn('slug', $slugs)->get(['id', 'slug', 'merged_into_id']) as $brand) {
            $found[(string) $brand->getAttribute('slug')] = (int) CatalogSlugs::survivor($brand)->getKey();
        }

        // In the order asked for.
        return array_intersect_key(array_replace(array_flip($slugs), $found), $found);
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    private static function integer(mixed $value): ?int
    {
        return is_numeric($value) ? (int) $value : null;
    }

    /**
     * @return list<string>
     */
    private static function list(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        $values = array_map(fn (mixed $entry): string => is_scalar($entry) ? trim((string) $entry) : '', $value);

        return array_values(array_unique(array_filter($values, fn (string $entry): bool => $entry !== '')));
    }
}
