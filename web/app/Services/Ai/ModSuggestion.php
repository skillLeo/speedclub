<?php

namespace App\Services\Ai;

use App\Enums\ModFieldType;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Services\Garage\ModFields;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * ai.mod_assist prompt and post-check (GAR-10 "Aus Text übernehmen"): the categories and their field schemas go into the prompt; of
 * the answer only fields of the chosen category survive that pass the member's own validator (ModFields), brands of the catalogue, and
 * numbers that stand in the pasted text. Nothing is saved: the app shows each field with accept/discard.
 */
final class ModSuggestion
{
    public function __construct(private readonly ModFields $modFields) {}

    /**
     * Active categories (or the one asked for) with their live fields.
     *
     * @return Collection<int, ModCategory>
     */
    public function categories(?string $key): Collection
    {
        return ModCategory::query()->where('active', true)
            ->when($key !== null, fn ($query) => $query->where('key', $key))
            ->with(['fields' => fn ($query) => $query->whereNull('archived_at')->orderBy('sort')])
            ->orderBy('sort')
            ->get();
    }

    /**
     * @param  Collection<int, ModCategory>  $categories
     */
    public function prompt(Collection $categories, string $text): string
    {
        $schema = $categories->map(fn (ModCategory $category): array => [
            'key' => $category->getAttribute('key'),
            'name' => $category->getAttribute('name'),
            'fields' => $category->fields->map(fn (ModCategoryField $field): array => array_filter([
                'key' => $field->getAttribute('key'),
                'type' => $field->type->value,
                'unit' => $field->getAttribute('unit'),
                'options' => $field->type === ModFieldType::Select ? array_values(array_filter(array_map(
                    fn (mixed $option): mixed => is_array($option) ? ($option['value'] ?? null) : $option,
                    $field->options ?? [],
                ), is_string(...))) : null,
                'min' => $field->min,
                'max' => $field->max,
            ], fn (mixed $value): bool => $value !== null))->values()->all(),
        ])->values()->all();

        return "Categories and fields (JSON):\n".json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n\nText:\n".$text;
    }

    /**
     * @param  Collection<int, ModCategory>  $categories
     * @return array{category_key: string, fields: array<string, bool|float|int|string>}|null null when the answer names no offered category
     */
    public function resolve(AiAnswer $answer, Collection $categories, string $text): ?array
    {
        $category = $categories->first(fn (ModCategory $category): bool => $category->getAttribute('key') === $answer->string('category_key'));

        if (! $category instanceof ModCategory) {
            return null;
        }

        /** @var Collection<string, ModCategoryField> $schema */
        $schema = $category->fields->keyBy('key');
        $fields = [];

        foreach ($answer->list('fields') as $item) {
            $key = is_array($item) && is_string($item['key'] ?? null) ? $item['key'] : null;
            $raw = is_array($item) && is_scalar($item['value'] ?? null) ? trim((string) $item['value']) : '';
            $field = $key === null ? null : $schema->get($key);

            if ($field === null || $raw === '' || array_key_exists($key, $fields)) {
                continue;
            }

            $value = $this->value($field, $raw, $text);

            if ($value !== null && $this->accepts($category, $key, $value)) {
                $fields[$key] = $value;
            }
        }

        return ['category_key' => (string) $category->getAttribute('key'), 'fields' => $fields];
    }

    private function value(ModCategoryField $field, string $raw, string $text): bool|float|int|string|null
    {
        return match ($field->type) {
            ModFieldType::Number => self::number($raw, $text),
            ModFieldType::Boolean => match (mb_strtolower($raw)) {
                'true', 'ja', 'yes' => true,
                'false', 'nein', 'no' => false,
                default => null,
            },
            ModFieldType::Select => self::option($field, $raw),
            ModFieldType::Brand => CatalogLookup::brand($raw)?->getAttribute('name'),
            // Free text may quote the input, but never brings a number of its own.
            ModFieldType::Text => mb_strlen($raw) <= 160 && Numbers::allFrom($raw, $text) && ! NeverList::violatedBy($raw, $text) ? $raw : null,
        };
    }

    private static function number(string $raw, string $text): int|float|null
    {
        $plain = str_replace(',', '.', $raw);

        if (! is_numeric($plain) || ! Numbers::isFrom((float) $plain, $text)) {
            return null;
        }

        $number = (float) $plain;

        return floor($number) === $number && abs($number) < PHP_INT_MAX ? (int) $number : $number;
    }

    private static function option(ModCategoryField $field, string $raw): ?string
    {
        foreach ($field->options ?? [] as $option) {
            $value = is_array($option) ? ($option['value'] ?? null) : $option;

            if (is_string($value) && mb_strtolower($value) === mb_strtolower($raw)) {
                return $value;
            }
        }

        return null;
    }

    /** The member's own validator on this one field (its errors on other, required fields do not matter here). */
    private function accepts(ModCategory $category, string $key, bool|float|int|string $value): bool
    {
        try {
            $this->modFields->validated($category, [$key => $value]);
        } catch (ValidationException $invalid) {
            return ! array_key_exists('fields.'.$key, $invalid->errors());
        }

        return true;
    }
}
