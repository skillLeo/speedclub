<?php

namespace App\Http\Resources\V1;

use App\Enums\ModFieldType;
use App\Models\ModCategoryField;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The schema the app builds and validates its modification form from (02_PRODUCT_SPEC §3.3).
 *
 * @mixin ModCategoryField
 */
class ModCategoryFieldResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->key,
            /** @var string */
            'label' => $this->getTranslation('label', app()->getLocale()),
            'type' => $this->type,
            'unit' => $this->unit,
            'min' => $this->min,
            'max' => $this->max,
            'step' => $this->step,
            'options' => $this->localizedOptions(),
            /** Regular expression a text value must match. */
            'pattern' => $this->textHint('pattern'),
            /** Sample value for a text field, for the input placeholder. */
            'example' => $this->textHint('example'),
            'required' => $this->required,
            'searchable' => $this->searchable,
            'facet' => $this->facet,
            /** M3.3 (ADM-15): archived, so not offered for new entries; still shown with the values of existing modifications. */
            'archived' => $this->archived_at !== null,
        ];
    }

    /**
     * Text fields keep {pattern, example} in the same column (ModCategorySeeder); only select fields have options.
     */
    private function textHint(string $key): ?string
    {
        /** @var array<array-key, mixed>|null $options */
        $options = $this->getAttribute('options');

        if ($this->getAttribute('type') !== ModFieldType::Text || ! is_string($options[$key] ?? null)) {
            return null;
        }

        return $options[$key];
    }

    /**
     * Seeded either as plain strings or as {value, label{de, en}}; clients always get {value, label}.
     *
     * @return list<array{value: string, label: string}>|null
     */
    private function localizedOptions(): ?array
    {
        /** @var array<array-key, mixed>|null $options */
        $options = $this->getAttribute('options');

        if ($options === null || $this->getAttribute('type') !== ModFieldType::Select) {
            return null;
        }

        $localized = [];

        foreach ($options as $option) {
            if (is_array($option)) {
                $label = $option['label'] ?? $option['value'] ?? '';

                if (is_array($label)) {
                    $label = $label[app()->getLocale()] ?? reset($label);
                }

                $localized[] = ['value' => is_scalar($option['value'] ?? null) ? (string) $option['value'] : '', 'label' => is_scalar($label) ? (string) $label : ''];
            } else {
                $text = is_scalar($option) ? (string) $option : '';
                $localized[] = ['value' => $text, 'label' => $text];
            }
        }

        return $localized;
    }
}
