<?php

namespace App\Services\Ai;

use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\VehicleModel;
use App\Services\Discover\SearchFilterResolver;
use BackedEnum;

/**
 * ai.nl_search post-check: the chips a model proposed → Discover filter chips the app applies as normal, editable filters (DISC-02).
 * Every value is resolved against the catalogue and the Discover facets (SearchFilterResolver); unknown values, unknown facets and
 * numbers that are not in the search text are dropped, and what is left must resolve as one filter set.
 */
final class SearchChips
{
    public const FACETS = [
        'make', 'model', 'generation', 'year_min', 'year_max', 'power_min', 'power_max', 'drivetrain', 'gearbox', 'fuel',
        'wheel_diameter', 'wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand', 'mod_category',
    ];

    /** Facets that hold one value; the list facets take several. */
    private const SINGLE = ['make', 'model', 'generation', 'year_min', 'year_max', 'power_min', 'power_max'];

    private const ENUMS = ['drivetrain' => Drivetrain::class, 'gearbox' => Gearbox::class, 'fuel' => Fuel::class];

    public function __construct(private readonly SearchFilterResolver $resolver) {}

    /** The user turn: the search text, then the values the closed facets allow. */
    public function prompt(string $query): string
    {
        $lines = ['Search text: '.$query, '', 'Allowed values of the closed facets:'];

        foreach (self::ENUMS as $facet => $enum) {
            $lines[] = '- '.$facet.': '.implode(', ', array_map(fn (BackedEnum $case): string => (string) $case->value, $enum::cases()));
        }

        $lines[] = '- suspension_type: '.implode(', ', SearchFilterResolver::suspensionTypes());
        $lines[] = '- mod_category: '.implode(', ', array_keys(SearchFilterResolver::categoryBits()));

        return implode("\n", $lines);
    }

    /**
     * @param  list<mixed>  $proposed  [{facet, value}]
     * @return list<array{facet: string, value: string, label: string}>
     */
    public function resolve(array $proposed, string $query): array
    {
        $chips = [];
        $make = null;
        $model = null;

        // make before model before generation, whatever order the model answered in.
        usort($proposed, fn (mixed $a, mixed $b): int => self::rank($a) <=> self::rank($b));

        foreach ($proposed as $chip) {
            $facet = is_array($chip) && is_string($chip['facet'] ?? null) ? $chip['facet'] : null;
            $value = is_array($chip) && is_scalar($chip['value'] ?? null) ? trim((string) $chip['value']) : '';

            if ($facet === null || ! in_array($facet, self::FACETS, true) || $value === '' || mb_strlen($value) > 60) {
                continue;
            }

            if (in_array($facet, self::SINGLE, true) && isset($chips[$facet])) {
                continue;
            }

            $resolved = match ($facet) {
                'make' => ($make = CatalogLookup::make($value)) === null ? null : [$make->slug, $make->name],
                'model' => $make instanceof Make && ($model = CatalogLookup::model($make, $value)) !== null ? [$model->slug, $model->name] : null,
                'generation' => $model instanceof VehicleModel && ($generation = CatalogLookup::generation($model, $value)) !== null ? [$generation->slug, $generation->name] : null,
                'year_min', 'year_max' => self::year($value, $query),
                'power_min', 'power_max' => self::power($value, $query),
                'drivetrain', 'gearbox', 'fuel' => self::enum(self::ENUMS[$facet], $value),
                'wheel_diameter' => self::diameter($value, $query),
                'wheel_brand', 'suspension_brand', 'exhaust_brand' => ($brand = CatalogLookup::brand($value)) === null ? null : [(string) $brand->getAttribute('slug'), (string) $brand->getAttribute('name')],
                'suspension_type' => self::suspensionType($value),
                'mod_category' => self::category($value),
            };

            if ($resolved === null) {
                continue;
            }

            [$slug, $label] = $resolved;
            $key = in_array($facet, self::SINGLE, true) ? $facet : $facet.'|'.$slug;
            $chips[$key] = ['facet' => $facet, 'value' => (string) $slug, 'label' => (string) $label];
        }

        return $this->consistent(array_values($chips));
    }

    /**
     * Drops the chips whose facet the Discover resolver refuses in combination (a model without its make, a year range the wrong way).
     *
     * @param  list<array{facet: string, value: string, label: string}>  $chips
     * @return list<array{facet: string, value: string, label: string}>
     */
    private function consistent(array $chips): array
    {
        for ($round = 0; $round < 3; $round++) {
            $single = [];
            $lists = [];

            foreach ($chips as $chip) {
                if (in_array($chip['facet'], self::SINGLE, true)) {
                    $single[$chip['facet']] = $chip['value'];
                } else {
                    $lists[$chip['facet']][] = $chip['value'];
                }
            }

            $errors = $this->resolver->resolve([...$single, ...$lists])['errors'];

            if ($errors === []) {
                return $chips;
            }

            $chips = array_values(array_filter($chips, fn (array $chip): bool => ! isset($errors[$chip['facet']])));
        }

        return [];
    }

    private static function rank(mixed $chip): int
    {
        $facet = is_array($chip) ? ($chip['facet'] ?? null) : null;

        return match ($facet) {
            'make' => 0,
            'model' => 1,
            'generation' => 2,
            default => 3,
        };
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private static function year(string $value, string $query): ?array
    {
        $year = filter_var($value, FILTER_VALIDATE_INT);

        return is_int($year) && $year >= 1950 && $year <= (int) date('Y') + 1 && Numbers::isFrom($year, $query) ? [(string) $year, (string) $year] : null;
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private static function power(string $value, string $query): ?array
    {
        $power = filter_var($value, FILTER_VALIDATE_INT);

        return is_int($power) && $power >= 1 && $power <= 2000 && Numbers::isFrom($power, $query) ? [(string) $power, $power.' PS'] : null;
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private static function diameter(string $value, string $query): ?array
    {
        $inches = is_numeric(str_replace(',', '.', $value)) ? (float) str_replace(',', '.', $value) : null;

        if ($inches === null || $inches < 10 || $inches > 26 || ! Numbers::isFrom($inches, $query)) {
            return null;
        }

        $diameter = SearchFilterResolver::diameter($inches);

        return [$diameter, $diameter.'″'];
    }

    /**
     * @param  class-string<Drivetrain|Gearbox|Fuel>  $enum
     * @return array{0: string, 1: string}|null
     */
    private static function enum(string $enum, string $value): ?array
    {
        $case = $enum::tryFrom(strtolower($value));

        return $case === null ? null : [$case->value, $case->label()];
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private static function suspensionType(string $value): ?array
    {
        foreach (SearchFilterResolver::suspensionTypeOptions() as $option) {
            if ($option['value'] === strtolower($value)) {
                return [$option['value'], $option['label'][app()->getLocale()] ?? $option['label']['de'] ?? $option['value']];
            }
        }

        return null;
    }

    /**
     * @return array{0: string, 1: string}|null
     */
    private static function category(string $value): ?array
    {
        if (! array_key_exists(strtolower($value), SearchFilterResolver::categoryBits())) {
            return null;
        }

        $category = ModCategory::query()->where('key', strtolower($value))->first();

        return $category === null ? null : [(string) $category->getAttribute('key'), (string) $category->getAttribute('name')];
    }
}
