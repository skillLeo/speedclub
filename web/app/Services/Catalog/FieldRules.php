<?php

namespace App\Services\Catalog;

use App\Enums\ModFieldType;
use App\Models\ModCategoryField;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The input of the ADM-15 field editor, in the shape the garage reads (ModFields, ModCategoryFieldResource, ModCategorySeeder):
 * key, label {de, en}, type (02_PRODUCT_SPEC §3.3: number, text, boolean, select, brand), unit, min/max/step (number only, step > 0),
 * options (select: [{value, label {de, en}}]; text: {pattern?, example?}; else none), required, searchable, facet, sort.
 */
final class FieldRules
{
    public const KEY = '/^[a-z][a-z0-9_]{0,59}$/';

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed> the validated keys, normalised
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?ModCategoryField $existing): array
    {
        $create = $existing === null;
        $required = $create ? 'required' : 'sometimes';
        $type = ModFieldType::tryFrom((string) ($input['type'] ?? $existing?->type->value ?? ''));

        $rules = [
            'key' => [$required, 'string', 'regex:'.self::KEY],
            'label' => [$required, 'array:de,en'],
            'label.de' => ['required_with:label', 'string', 'min:1', 'max:80'],
            'label.en' => ['required_with:label', 'string', 'min:1', 'max:80'],
            'type' => [$required, Rule::enum(ModFieldType::class)],
            'unit' => ['sometimes', 'nullable', 'string', 'max:20'],
            'min' => ['sometimes', 'nullable', 'numeric', 'between:-99999999,99999999'],
            'max' => ['sometimes', 'nullable', 'numeric', 'between:-99999999,99999999'],
            'step' => ['sometimes', 'nullable', 'numeric', 'gt:0', 'max:99999999'],
            'options' => ['sometimes', 'nullable', 'array'],
            'required' => ['sometimes', 'boolean'],
            'searchable' => ['sometimes', 'boolean'],
            'facet' => ['sometimes', 'boolean'],
            'sort' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];

        if ($type === ModFieldType::Select) {
            $rules['options'] = [$create || array_key_exists('type', $input) ? 'required' : 'sometimes', 'array', 'list', 'min:1', 'max:100'];
            $rules['options.*'] = ['array:value,label'];
            $rules['options.*.value'] = ['required', 'string', 'regex:/^[a-z0-9_]{1,40}$/', 'distinct'];
            $rules['options.*.label'] = ['required', 'array:de,en'];
            $rules['options.*.label.de'] = ['required', 'string', 'max:80'];
            $rules['options.*.label.en'] = ['required', 'string', 'max:80'];
        } elseif ($type === ModFieldType::Text) {
            $rules['options'] = ['sometimes', 'nullable', 'array:pattern,example'];
            $rules['options.pattern'] = ['sometimes', 'nullable', 'string', 'max:200'];
            $rules['options.example'] = ['sometimes', 'nullable', 'string', 'max:60'];
        } else {
            $rules['options'] = ['sometimes', 'nullable', 'prohibited'];
        }

        if ($type !== ModFieldType::Number) {
            foreach (['min', 'max', 'step'] as $bound) {
                $rules[$bound] = ['sometimes', 'nullable', 'prohibited'];
            }
        }

        $validator = Validator::make($input, $rules);
        $validator->after(function ($validator) use ($input, $existing): void {
            $min = array_key_exists('min', $input) ? $input['min'] : $existing?->min;
            $max = array_key_exists('max', $input) ? $input['max'] : $existing?->max;

            if (is_numeric($min) && is_numeric($max) && (float) $min > (float) $max) {
                $validator->errors()->add('max', (string) __('validation.gte.numeric', ['attribute' => 'max', 'value' => $min]));
            }

            $pattern = is_array($input['options'] ?? null) ? ($input['options']['pattern'] ?? null) : null;

            // The garage runs it as ~pattern~D (ModFields): it must compile, and as it is admin input, it is checked here.
            if (is_string($pattern) && $pattern !== '' && @preg_match('~'.$pattern.'~D', '') === false) {
                $validator->errors()->add('options.pattern', (string) __('validation.regex', ['attribute' => 'pattern']));
            }
        });

        /** @var array<string, mixed> $valid */
        $valid = $validator->validate();

        foreach (['min', 'max', 'step'] as $bound) {
            if (array_key_exists($bound, $valid) && $valid[$bound] !== null) {
                $valid[$bound] = (float) $valid[$bound];
            }
        }

        if (($valid['type'] ?? null) !== null && $type !== ModFieldType::Number) {
            $valid += ['min' => null, 'max' => null, 'step' => null];
        }

        if (array_key_exists('type', $valid) && ! in_array($type, [ModFieldType::Select, ModFieldType::Text], true)) {
            $valid['options'] = null;
        }

        return $valid;
    }
}
