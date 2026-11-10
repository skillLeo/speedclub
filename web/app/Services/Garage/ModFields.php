<?php

namespace App\Services\Garage;

use App\Enums\ModFieldType;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * The JSON of a modification against mod_category_fields of its category (02_PRODUCT_SPEC §3.3). The schema is data an admin
 * can edit (ADM-15), so a FormRequest cannot hold these rules. Errors are keyed fields.<key> for the form.
 */
class ModFields
{
    /** Fields that name the same thing as the common brand column, in the order they are looked at. */
    public const BRAND_FIELDS = ['brand', 'wheel_brand', 'tuner'];

    private const MAX_TEXT = 160;

    /** modifications.brand_text */
    private const MAX_BRAND = 120;

    /**
     * @param  array<array-key, mixed>  $fields
     * @return array<string, bool|float|int|string> what to store: no null values, no rear diameter equal to the front
     *
     * @throws ValidationException
     */
    public function validated(ModCategory $category, array $fields): array
    {
        $schema = $this->schema($category);

        if ($fields !== [] && array_is_list($fields)) {
            throw ValidationException::withMessages(['fields' => [(string) __('garage.mod_fields.object')]]);
        }

        $errors = [];
        $clean = [];

        foreach ($fields as $key => $value) {
            $field = $schema->get((string) $key);

            if ($field === null) {
                $errors['fields.'.$key] = [(string) __('garage.mod_fields.unknown')];

                continue;
            }

            if ($value === null) {
                continue;
            }

            $message = $this->violation($field, $value);

            if ($message !== null) {
                $errors['fields.'.$key] = [$message];

                continue;
            }

            /** @var bool|float|int|string $value */
            $clean[(string) $key] = $value;
        }

        foreach ($schema as $key => $field) {
            if ($field->required && ! array_key_exists((string) $key, $clean) && ! isset($errors['fields.'.$key])) {
                $errors['fields.'.$key] = [(string) __('garage.mod_fields.required', ['field' => $this->label($field)])];
            }
        }

        // ADR-112: diameter is the front or only size, the rear exists only when it differs.
        if (isset($clean['diameter_rear']) && $schema->has('diameter')) {
            if (! isset($clean['diameter']) && ! isset($errors['fields.diameter'])) {
                $errors['fields.diameter_rear'] = [(string) __('garage.mod_fields.rear_without_front')];
            } elseif (isset($clean['diameter']) && (float) $clean['diameter_rear'] === (float) $clean['diameter']) {
                unset($clean['diameter_rear']);
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $clean;
    }

    /**
     * @return Collection<string, ModCategoryField>
     */
    private function schema(ModCategory $category): Collection
    {
        /** @var Collection<string, ModCategoryField> $schema */
        $schema = $category->fields->keyBy('key');

        return $schema;
    }

    private function violation(ModCategoryField $field, mixed $value): ?string
    {
        return match ($field->type) {
            ModFieldType::Number => $this->numberViolation($field, $value),
            ModFieldType::Boolean => is_bool($value) ? null : $this->message('boolean', $field),
            ModFieldType::Select => in_array($value, $this->optionValues($field), true) ? null : $this->message('option', $field),
            ModFieldType::Brand, ModFieldType::Text => $this->textViolation($field, $value),
        };
    }

    /**
     * Strictly a JSON number: "19 cm" or {"value": 19, "unit": "cm"} are refused, since every field has one fixed unit.
     */
    private function numberViolation(ModCategoryField $field, mixed $value): ?string
    {
        if (! is_int($value) && ! is_float($value)) {
            return $this->message('number', $field);
        }

        if ($field->min !== null && $value < $field->min) {
            return $this->message('min', $field, ['min' => $field->min]);
        }

        if ($field->max !== null && $value > $field->max) {
            return $this->message('max', $field, ['max' => $field->max]);
        }

        if ($field->step !== null && $field->step > 0) {
            $steps = ($value - ($field->min ?? 0.0)) / $field->step;

            if (abs($steps - round($steps)) > 1e-9) {
                return $this->message('step', $field, ['step' => $field->step]);
            }
        }

        return null;
    }

    private function textViolation(ModCategoryField $field, mixed $value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return $this->message('text', $field);
        }

        $maximum = $field->type === ModFieldType::Brand || in_array($field->getAttribute('key'), self::BRAND_FIELDS, true) ? self::MAX_BRAND : self::MAX_TEXT;

        if (mb_strlen($value) > $maximum) {
            return $this->message('too_long', $field, ['max' => $maximum]);
        }

        /** @var array<string, mixed> $options */
        $options = $field->options ?? [];
        $pattern = $options['pattern'] ?? null;

        // D: a dollar sign means the end of the text, not a line break before it.
        if (is_string($pattern) && preg_match('~'.$pattern.'~D', $value) !== 1) {
            $example = $options['example'] ?? '';

            return $this->message('pattern', $field, ['example' => is_string($example) ? $example : '']);
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function optionValues(ModCategoryField $field): array
    {
        $values = [];

        foreach ($field->options ?? [] as $option) {
            $value = is_array($option) ? ($option['value'] ?? null) : $option;

            if (is_string($value)) {
                $values[] = $value;
            }
        }

        return $values;
    }

    /**
     * @param  array<string, mixed>  $replace
     */
    private function message(string $key, ModCategoryField $field, array $replace = []): string
    {
        return (string) __('garage.mod_fields.'.$key, ['field' => $this->label($field), ...$replace]);
    }

    private function label(ModCategoryField $field): string
    {
        return $field->getTranslation('label', app()->getLocale());
    }
}
