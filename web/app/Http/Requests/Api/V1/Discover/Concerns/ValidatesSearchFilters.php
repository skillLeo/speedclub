<?php

namespace App\Http\Requests\Api\V1\Discover\Concerns;

use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Services\Discover\SearchFilterResolver;
use App\Services\Discover\SearchFilters;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use LogicException;

/**
 * The DISC-02 filter parameters (m2.3 contract §1, 02_PRODUCT_SPEC §3.7). Lists are bracketed (`drivetrain[]=rear&drivetrain[]=all`),
 * as openapi-fetch sends arrays; a plain `drivetrain=rear` is refused. Slugs are looked up after the types pass (SearchFilterResolver),
 * so an unknown one answers 422 on its own field.
 */
trait ValidatesSearchFilters
{
    private ?SearchFilters $resolvedFilters = null;

    /**
     * @return array<string, mixed>
     */
    protected function filterRules(): array
    {
        $year = (int) now()->format('Y') + 1;
        $slug = ['string', 'max:140', 'regex:/^[a-z0-9]+(?:-{1,2}[a-z0-9]+)*$/'];
        $list = ['nullable', 'array', 'max:30'];

        return [
            /** Make slug, "bmw". */
            'make' => ['nullable', ...$slug],
            /** Model slug of `make` ("m4"), or the model page key "bmw--m4" without `make`. */
            'model' => ['nullable', ...$slug],
            /** Generation slug of `model` ("g82"). */
            'generation' => ['nullable', ...$slug],
            /** Model year from, inclusive. */
            'year_min' => ['nullable', 'integer', 'min:1900', 'max:'.$year],
            /** Model year to, inclusive. */
            'year_max' => ['nullable', 'integer', 'min:1900', 'max:'.$year],
            /** PS from, inclusive, 50–1500. */
            'power_min' => ['nullable', 'integer', 'min:50', 'max:1500'],
            /** PS to, inclusive, 50–1500. */
            'power_max' => ['nullable', 'integer', 'min:50', 'max:1500'],
            'drivetrain' => $list,
            'drivetrain.*' => ['string', Rule::enum(Drivetrain::class)],
            'gearbox' => $list,
            'gearbox.*' => ['string', Rule::enum(Gearbox::class)],
            'fuel' => $list,
            'fuel.*' => ['string', Rule::enum(Fuel::class)],
            'wheel_diameter' => $list,
            /** Inches, 13–24 in half-inch steps: front or rear of any installed wheel set. */
            'wheel_diameter.*' => ['numeric', 'min:13', 'max:24', 'multiple_of:0.5'],
            'wheel_brand' => $list,
            /** Brand slug ("bbs"). */
            'wheel_brand.*' => $slug,
            'suspension_type' => $list,
            /** Option value of the suspension type field ("coilover"). */
            'suspension_type.*' => ['string', 'max:40'],
            'suspension_brand' => $list,
            'suspension_brand.*' => $slug,
            'exhaust_brand' => $list,
            'exhaust_brand.*' => $slug,
            'mod_category' => $list,
            /** Category key ("wheels_tires"): the build has an installed mod in it. */
            'mod_category.*' => ['string', 'max:40'],
        ];
    }

    /**
     * @return array<string, string>
     */
    protected function filterMessages(): array
    {
        $value = (string) __('discover.filters.unknown_value');
        $messages = [];

        foreach (SearchFilterResolver::LIST_KEYS as $key) {
            $messages["$key.array"] = (string) __('discover.filters.list');
            $messages["$key.*.enum"] = $value;
            $messages["$key.*.regex"] = $value;
        }

        foreach (['make', 'model', 'generation'] as $key) {
            $messages["$key.regex"] = (string) __('discover.filters.unknown_'.$key);
        }

        return [
            ...$messages,
            'wheel_diameter.*.numeric' => (string) __('discover.filters.wheel_diameter'),
            'wheel_diameter.*.min' => (string) __('discover.filters.wheel_diameter'),
            'wheel_diameter.*.max' => (string) __('discover.filters.wheel_diameter'),
            'wheel_diameter.*.multiple_of' => (string) __('discover.filters.wheel_diameter'),
        ];
    }

    /**
     * Resolves the slugs once the types passed; the errors land on their own fields.
     */
    protected function resolveFilters(Validator $validator): void
    {
        if ($validator->errors()->isNotEmpty()) {
            return;
        }

        $resolved = app(SearchFilterResolver::class)->resolve($validator->validated());

        foreach ($resolved['errors'] as $field => $message) {
            $validator->errors()->add($field, $message);
        }

        $this->resolvedFilters = $resolved['filters'];
    }

    public function filters(): SearchFilters
    {
        return $this->resolvedFilters ?? throw new LogicException('The filters are resolved during validation.');
    }
}
