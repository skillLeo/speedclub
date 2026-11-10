<?php

namespace App\Services\Catalog;

use App\Enums\CatalogLevel;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\VehicleModel;
use App\Support\Slug;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The input rules of the catalogue Actions (manual edits and CSV rows alike). Slugs are lowercase words joined by single dashes, so a
 * DISC-04 key "{make}--{model}" stays unambiguous (ModelKey).
 */
final class EntryRules
{
    public const SLUG = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public const FIRST_YEAR = 1886;

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed> the validated keys only
     *
     * @throws ValidationException
     */
    public static function entry(CatalogLevel $level, array $input, bool $create): array
    {
        $required = $create ? 'required' : 'sometimes';
        $lastYear = Carbon::now(config()->string('speedclub.display_timezone'))->year + 2;

        $rules = [
            'name' => [$required, 'string', 'min:1', 'max:100'],
            'slug' => ['sometimes', 'nullable', 'string', 'max:120', 'regex:'.self::SLUG],
        ];

        $rules += match ($level) {
            CatalogLevel::Make => [
                'country' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Za-z]{2}$/'],
                'is_popular' => ['sometimes', 'boolean'],
                'sort' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            ],
            CatalogLevel::Model => $create ? ['make_id' => ['required', 'integer', Rule::exists(Make::class, 'id')->whereNull('merged_into_id')]] : [],
            CatalogLevel::Generation => [
                ...($create ? ['model_id' => ['required', 'integer', Rule::exists(VehicleModel::class, 'id')->whereNull('merged_into_id')]] : []),
                'year_from' => ['sometimes', 'nullable', 'integer', 'min:'.self::FIRST_YEAR, 'max:'.$lastYear],
                'year_to' => ['sometimes', 'nullable', 'integer', 'min:'.self::FIRST_YEAR, 'max:'.$lastYear],
            ],
            CatalogLevel::Brand => [
                'category_hint' => ['sometimes', 'nullable', 'string', Rule::exists(ModCategory::class, 'key')],
                'aliases' => ['sometimes', 'nullable', 'array', 'max:20'],
                'aliases.*' => ['string', 'min:1', 'max:120', 'distinct:ignore_case'],
            ],
        };

        if ($create && $level !== CatalogLevel::Brand) {
            $rules['active'] = ['sometimes', 'boolean'];
        }

        if ($level === CatalogLevel::Brand) {
            $rules['name'] = [$required, 'string', 'min:1', 'max:120'];
            $rules['slug'] = ['sometimes', 'nullable', 'string', 'max:140', 'regex:'.self::SLUG];
        }

        $validator = Validator::make($input, $rules);
        $validator->after(function ($validator) use ($input): void {
            $from = $input['year_from'] ?? null;
            $to = $input['year_to'] ?? null;

            if (is_int($from) && is_int($to) && $from > $to) {
                $validator->errors()->add('year_to', (string) __('validation.gte.numeric', ['attribute' => 'year to', 'value' => $from]));
            }
        });

        /** @var array<string, mixed> $valid */
        $valid = $validator->validate();

        foreach (['name', 'slug'] as $key) {
            if (is_string($valid[$key] ?? null)) {
                $valid[$key] = trim($valid[$key]);
            }
        }

        if (is_string($valid['country'] ?? null)) {
            $valid['country'] = strtoupper($valid['country']);
        }

        if (isset($valid['aliases']) && is_array($valid['aliases'])) {
            $aliases = array_values(array_filter(array_map(fn (mixed $alias): string => trim((string) $alias), $valid['aliases']), fn (string $alias): bool => $alias !== ''));
            $valid['aliases'] = $aliases === [] ? null : $aliases;
        }

        return $valid;
    }

    /**
     * The slug an entry gets: the one given, else the name's (App\Support\Slug).
     *
     * @throws ValidationException when the name has nothing a slug can hold ("???")
     */
    public static function slug(?string $given, string $name): string
    {
        $slug = $given !== null && $given !== '' ? $given : Slug::make($name);

        if ($slug === '' || preg_match(self::SLUG, $slug) !== 1) {
            throw ValidationException::withMessages(['slug' => [(string) __('validation.regex', ['attribute' => 'slug'])]]);
        }

        return $slug;
    }

    /**
     * Whether another row of the level already holds $slug in the same scope (merged rows included: their slugs are aliases).
     */
    public static function slugTaken(CatalogLevel $level, string $slug, ?int $parentId, ?int $except = null): bool
    {
        $query = match ($level) {
            CatalogLevel::Make => Make::query(),
            CatalogLevel::Model => VehicleModel::query()->where('make_id', $parentId),
            CatalogLevel::Generation => Generation::query()->where('model_id', $parentId),
            CatalogLevel::Brand => Brand::query(),
        };

        return $query->where('slug', $slug)->when($except !== null, fn ($q) => $q->whereKeyNot($except))->exists();
    }
}
