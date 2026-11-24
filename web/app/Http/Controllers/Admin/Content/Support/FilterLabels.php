<?php

namespace App\Http\Controllers\Admin\Content\Support;

use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\VehicleModel;

/**
 * DQ-P5-102: the names behind the values of ADM-29's filter collections, so a row reads "Marke: Nissan · Baujahr bis 2002" instead of
 * Discover's address (`make=nissan&year_max=2002`). Per filter key, value → name in the staff member's language: catalogue names for
 * make, model and generation slugs, the enum labels for drivetrain, gearbox and fuel, the option labels of the suspension type, and the
 * mod category names. Only the values the given collections use are looked up; a value without a name keeps its slug on the page.
 */
final class FilterLabels
{
    /**
     * @param  array<int, mixed>  $collections  the home_curation payload's collections
     * @return array<string, array<string, string>>
     */
    public function for(array $collections): array
    {
        $values = [];

        foreach ($collections as $collection) {
            $filters = is_array($collection) && is_array($collection['filters'] ?? null) ? $collection['filters'] : [];

            foreach ($filters as $key => $value) {
                foreach (is_array($value) ? $value : [$value] as $item) {
                    if (is_string($item) && $item !== '') {
                        $values[(string) $key][$item] = true;
                    }
                }
            }
        }

        $locale = app()->getLocale() === 'en' ? 'en' : 'de';
        $labels = [];
        $slugs = fn (string $key): array => array_map(strval(...), array_keys($values[$key] ?? []));

        if ($slugs('make') !== []) {
            $labels['make'] = Make::query()->whereIn('slug', $slugs('make'))->pluck('name', 'slug')->map(strval(...))->all();
        }

        if ($slugs('model') !== []) {
            $labels['model'] = VehicleModel::query()->whereIn('slug', $slugs('model'))
                ->when($slugs('make') !== [], fn ($query) => $query->whereHas('make', fn ($make) => $make->whereIn('slug', $slugs('make'))))
                ->pluck('name', 'slug')->map(strval(...))->all();
        }

        if ($slugs('generation') !== []) {
            $labels['generation'] = Generation::query()->whereIn('slug', $slugs('generation'))->pluck('name', 'slug')->map(strval(...))->all();
        }

        foreach (['drivetrain', 'gearbox', 'fuel'] as $key) {
            foreach ($slugs($key) as $value) {
                $case = match ($key) {
                    'drivetrain' => Drivetrain::tryFrom($value),
                    'gearbox' => Gearbox::tryFrom($value),
                    'fuel' => Fuel::tryFrom($value),
                };

                if ($case !== null) {
                    $labels[$key][$value] = $case->label($locale);
                }
            }
        }

        if ($slugs('mod_category') !== []) {
            foreach (ModCategory::query()->whereIn('key', $slugs('mod_category'))->get() as $category) {
                $labels['mod_category'][$category->key] = self::localized($category->getAttribute('name'), $locale) ?? $category->key;
            }
        }

        if ($slugs('suspension_type') !== []) {
            $field = ModCategoryField::query()->where('key', 'type')->whereHas('category', fn ($category) => $category->where('key', 'suspension'))->first();

            foreach (is_array($field?->options) ? $field->options : [] as $option) {
                $value = is_array($option) && is_string($option['value'] ?? null) ? $option['value'] : null;
                $label = is_array($option) ? self::localized($option['label'] ?? null, $locale) : null;

                if ($value !== null && $label !== null && in_array($value, $slugs('suspension_type'), true)) {
                    $labels['suspension_type'][$value] = $label;
                }
            }
        }

        return $labels;
    }

    /** A {de, en} name (array or its JSON) in $locale, else German. */
    private static function localized(mixed $name, string $locale): ?string
    {
        $name = is_string($name) ? json_decode($name, true) ?? $name : $name;

        if (is_string($name)) {
            return $name;
        }

        if (! is_array($name)) {
            return null;
        }

        $text = $name[$locale] ?? $name['de'] ?? null;

        return is_string($text) && $text !== '' ? $text : null;
    }
}
