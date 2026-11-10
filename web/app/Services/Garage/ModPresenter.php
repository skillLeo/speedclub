<?php

namespace App\Services\Garage;

use App\Enums\ModFieldType;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Support\Units;

/**
 * How stored modification values read on screen (02_PRODUCT_SPEC §3.9): wheels 19″ × 9,5J ET35, tyres 255/35 R19, lowering
 * −35 mm. FS-6's live preview shows the same line the server sends, "BBS LM · 19″ × 9,5J ET35 · 255/35 R19".
 */
class ModPresenter
{
    private const SEPARATOR = ' · ';

    /**
     * The one line of a mod row and of a build update.
     *
     * @param  array<string, mixed>  $fields
     */
    public function summaryLine(string $title, ModCategory $category, array $fields, string $locale): string
    {
        $parts = [$title, ...match ($category->key) {
            'wheels_tires' => $this->wheelParts($fields, $locale),
            'suspension' => $this->loweringParts($fields, $locale),
            'engine_performance' => $this->enginePart($fields, $locale),
            'brakes' => $this->brakeParts($fields, $locale),
            default => [],
        }];

        return implode(self::SEPARATOR, array_filter($parts, fn (string $part): bool => $part !== ''));
    }

    /**
     * Labelled rows of VEH-02, in the order of the schema.
     *
     * @param  array<string, mixed>  $fields
     * @return list<array{key: string, label: string, value: string}>
     */
    public function specRows(ModCategory $category, array $fields, string $locale): array
    {
        $rows = [];

        foreach ($category->fields->sortBy('sort') as $field) {
            /** @var string $key */
            $key = $field->getAttribute('key');

            if (array_key_exists($key, $fields) && $fields[$key] !== null) {
                $rows[] = [
                    'key' => $key,
                    'label' => $field->getTranslation('label', $locale),
                    'value' => $this->fieldValue($field, $fields[$key], $locale),
                ];
            }
        }

        return $rows;
    }

    public function fieldValue(ModCategoryField $field, mixed $value, string $locale): string
    {
        return match ($field->type) {
            ModFieldType::Boolean => (string) __($value === true ? 'garage.yes' : 'garage.no', [], $locale),
            ModFieldType::Select => $this->optionLabel($field, $value, $locale),
            ModFieldType::Number => is_int($value) || is_float($value) ? $this->number($field, $value, $locale) : '',
            ModFieldType::Brand, ModFieldType::Text => is_scalar($value) ? $this->text($field, (string) $value, $locale) : '',
        };
    }

    /**
     * A bolt pattern reads the same whoever typed it: "5x114.3" and "5×114,3" are 5×114,3 in German and 5×114.3 in English (DQ-177).
     * Anything else stays as typed, and so does the stored value the editor opens with.
     */
    private function text(ModCategoryField $field, string $value, string $locale): string
    {
        if ($field->getAttribute('key') !== 'bolt_pattern' || preg_match('/^\s*(\d+)\s*[x×]\s*(\d+)(?:[.,](\d+))?\s*$/iu', $value, $parts) !== 1) {
            return $value;
        }

        $fraction = ($parts[3] ?? '') === '' ? '' : ($locale === 'de' ? ',' : '.').$parts[3];

        return $parts[1]."\u{00D7}".$parts[2].$fraction;
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return list<string>
     */
    private function wheelParts(array $fields, string $locale): array
    {
        $diameter = $this->pair($fields['diameter'] ?? null, $fields['diameter_rear'] ?? null, $locale);
        $width = $this->pair($fields['width_front'] ?? null, $fields['width_rear'] ?? null, $locale);
        $offset = $this->pair($fields['et_front'] ?? null, $fields['et_rear'] ?? null, $locale);

        $size = trim(implode(' ', array_filter([
            $diameter === null ? null : $diameter."\u{2033}",
            $width === null ? null : ($diameter === null ? '' : "\u{00D7} ").$width.'J',
            $offset === null ? null : 'ET'.$offset,
        ], fn (?string $part): bool => $part !== null)));

        $tyre = is_string($fields['tyre_size_front'] ?? null) ? $fields['tyre_size_front'] : '';

        return [$size, $tyre];
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return list<string>
     */
    private function loweringParts(array $fields, string $locale): array
    {
        $front = $fields['lowering_front'] ?? null;
        $rear = $fields['lowering_rear'] ?? null;

        if (! is_int($front) && ! is_float($front)) {
            return [];
        }

        return [(is_int($rear) || is_float($rear)) && (float) $rear !== (float) $front
            ? "\u{2212}".Units::formatNumber($front, $locale)."/\u{2212}".Units::formatNumber($rear, $locale).' mm'
            : Units::formatLowering($front, $locale)];
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return list<string>
     */
    private function enginePart(array $fields, string $locale): array
    {
        $power = $fields['claimed_power'] ?? null;

        return is_int($power) || is_float($power) ? [Units::formatNumber($power, $locale).' PS'] : [];
    }

    /**
     * @param  array<string, mixed>  $fields
     * @return list<string>
     */
    private function brakeParts(array $fields, string $locale): array
    {
        $disc = $fields['front_disc'] ?? null;

        return is_int($disc) || is_float($disc) ? [Units::formatNumber($disc, $locale).' mm'] : [];
    }

    /**
     * "9,5" for one size, "9/10,5" for two different ones.
     */
    private function pair(mixed $first, mixed $second, string $locale): ?string
    {
        if (! is_int($first) && ! is_float($first)) {
            return null;
        }

        $text = $this->signed($first, $locale);

        return (is_int($second) || is_float($second)) && (float) $second !== (float) $first
            ? $text.'/'.$this->signed($second, $locale)
            : $text;
    }

    private function signed(float|int $value, string $locale): string
    {
        return str_replace('-', "\u{2212}", Units::formatNumber($value, $locale));
    }

    private function number(ModCategoryField $field, float|int $value, string $locale): string
    {
        /** @var string $key */
        $key = $field->getAttribute('key');
        $text = $this->signed($value, $locale);

        return match (true) {
            str_starts_with($key, 'width_') => $text.'J',
            str_starts_with($key, 'et_') => 'ET'.$text,
            str_starts_with($key, 'lowering_') => Units::formatLowering($value, $locale),
            $field->getAttribute('unit') === 'in' => $text."\u{2033}",
            is_string($field->getAttribute('unit')) => $text.' '.$field->getAttribute('unit'),
            default => $text,
        };
    }

    private function optionLabel(ModCategoryField $field, mixed $value, string $locale): string
    {
        /** @var list<array{value?: string, label?: array<string, string>|string}|string> $options */
        $options = $field->getAttribute('options') ?? [];

        foreach ($options as $option) {
            if (is_array($option) && ($option['value'] ?? null) === $value) {
                $label = $option['label'] ?? '';

                return is_array($label) ? ($label[$locale] ?? (string) reset($label)) : $label;
            }
        }

        return is_scalar($value) ? (string) $value : '';
    }
}
