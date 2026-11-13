<?php

namespace App\Services\Garage;

use App\Enums\Aspiration;
use App\Enums\BuildUpdateType;
use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Enums\ModStatus;
use App\Enums\PowerDisplay;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\BuildUpdate;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Support\Units;

/**
 * Renders a stored update per viewer, "Fahrwerk: Serie → KW V3 · −35 mm", in the number formats of 02_PRODUCT_SPEC §3.9.
 *
 * @phpstan-type Detail array{label: string, before: string|null, after: string|null}
 * @phpstan-type RenderedChange array{kind: string, category: string|null, modification_id: string|null, label: string, before: string|null, after: string|null, text: string, details: list<Detail>}
 */
class BuildUpdatePresenter
{
    private const ARROW = " \u{2192} ";

    public function __construct(
        private readonly ModCatalog $catalog,
        private readonly ModPresenter $mods,
    ) {}

    /**
     * @param  int|null  $limit  the most to render, for lists: reading an entry costs its size, and a guest can ask for many
     * @return list<RenderedChange>
     */
    public function changes(BuildUpdate $update, PowerDisplay $display, string $locale, ?int $limit = null): array
    {
        /** @var array<string, mixed> $payload */
        $payload = $update->payload ?? [];

        if (isset($payload['changes']) && is_array($payload['changes'])) {
            /** @var list<array<string, mixed>> $changes */
            $changes = $limit === null ? $payload['changes'] : array_slice($payload['changes'], 0, $limit);

            return array_map(fn (array $change): array => $this->renderChange($change, $display, $locale), $changes);
        }

        // Rows from before the structured form hold the text only.
        if (isset($payload['after'])) {
            return [$this->rendered(
                $update->type->value,
                is_string($payload['category'] ?? null) ? $payload['category'] : null,
                is_string($payload['modification_id'] ?? null) ? $payload['modification_id'] : null,
                is_string($payload['label'] ?? null) ? $payload['label'] : '',
                is_string($payload['before'] ?? null) ? $payload['before'] : null,
                is_string($payload['after']) ? $payload['after'] : null,
            )];
        }

        return [];
    }

    /**
     * The bold title of an entry (DQ-290, 03_DESIGN_SYSTEM §8): the category and the verb of its first change, "Fahrwerk geändert",
     * "Räder hinzugefügt", "Abgasanlage entfernt"; "Technik aktualisiert", "Fotos hinzugefügt", "Notiz". A mixed entry takes its first
     * change. A category without a short name of its own (added later by staff) uses its catalogue name.
     */
    public function typeLabel(BuildUpdate $update, string $locale): string
    {
        /** @var array<string, mixed> $payload */
        $payload = $update->payload ?? [];
        $first = is_array($payload['changes'] ?? null) && is_array($payload['changes'][0] ?? null) ? $payload['changes'][0] : $payload;
        $kind = BuildUpdateType::tryFrom(is_string($first['kind'] ?? null) ? $first['kind'] : '') ?? $update->type;

        if ($update->type->isAuthored()) {
            $kind = $update->type;
        }

        if (! in_array($kind, [BuildUpdateType::ModAdded, BuildUpdateType::ModChanged, BuildUpdateType::ModRemoved], true)) {
            return (string) __('garage.update_title.'.$kind->value, [], $locale);
        }

        $key = is_string($first['category'] ?? null) ? $first['category'] : null;
        $short = $key === null ? null : trans('garage.update_title.parts.'.$key, [], $locale);
        $part = is_string($short) && $short !== 'garage.update_title.parts.'.$key
            ? $short
            : ($key === null ? null : $this->catalog->find($key)?->getTranslation('name', $locale));

        return $part === null || $part === '' ? $kind->label($locale) : (string) __('garage.update_title.'.$kind->value, ['part' => $part], $locale);
    }

    /**
     * How many changes the entry holds, without rendering any.
     */
    public function changesCount(BuildUpdate $update): int
    {
        /** @var array<string, mixed> $payload */
        $payload = $update->payload ?? [];

        if (isset($payload['changes']) && is_array($payload['changes'])) {
            return count($payload['changes']);
        }

        return isset($payload['after']) ? 1 : 0;
    }

    /**
     * One line for lists: the note, or the changes one after the other, and how many more there are than were rendered.
     *
     * @param  list<RenderedChange>  $rendered  from changes()
     */
    public function summary(BuildUpdate $update, array $rendered, string $locale): string
    {
        $note = $update->getAttribute('note');

        if ($update->type->isAuthored() && is_string($note)) {
            return $note;
        }

        $parts = array_column($rendered, 'text');
        $more = $this->changesCount($update) - count($rendered);

        if ($more > 0) {
            $parts[] = (string) __('garage.more_changes', ['count' => $more], $locale);
        }

        return implode(' · ', $parts);
    }

    /**
     * @param  array<string, mixed>  $change
     * @return RenderedChange
     */
    public function renderChange(array $change, PowerDisplay $display, string $locale): array
    {
        $kind = is_string($change['kind'] ?? null) ? $change['kind'] : '';

        return match ($kind) {
            BuildUpdateType::SpecsChanged->value => $this->specChange($change, $display, $locale),
            BuildUpdateType::PhotosAdded->value => $this->photoChange($change, $locale),
            default => $this->modChange($kind, $change, $locale),
        };
    }

    /**
     * @param  array<string, mixed>  $change
     * @return RenderedChange
     */
    private function modChange(string $kind, array $change, string $locale): array
    {
        $category = is_string($change['category'] ?? null) ? $this->catalog->find($change['category']) : null;
        $before = is_array($change['before'] ?? null) ? $change['before'] : null;
        $after = is_array($change['after'] ?? null) ? $change['after'] : null;

        $label = $category?->getTranslation('name', $locale) ?? '';
        $beforeLine = $before === null ? null : $this->line($before, $category, $locale);
        $afterLine = $after === null ? null : $this->line($after, $category, $locale);
        $details = $this->details($before, $after, $category, $locale);

        $beforeText = $beforeLine;
        $afterText = $afterLine;

        if ($after === null || ($after['status'] ?? null) === ModStatus::Removed->value) {
            $afterText = (string) __('garage.removed', [], $locale);
        } elseif (($after['status'] ?? null) === ModStatus::Planned->value) {
            $afterText = (string) __('garage.planned_prefix', ['title' => $afterLine], $locale);
        } elseif ($before === null) {
            $beforeText = (string) __('garage.stock', [], $locale);
        }

        // Same line on both sides: the difference is in a field the line does not show.
        if ($beforeText === $afterText && $details !== []) {
            $label = $details[0]['label'];
            $beforeText = $details[0]['before'];
            $afterText = $details[0]['after'];
        }

        // Texts written for an entry (the demo's story lines, BuildUpdates::backdated) are in one language: German unless they name another.
        // In any other language the entry renders from its snapshots, so an English card never shows "Serie 18″" (DQ-290 follow-up).
        /** @var array{label?: string, before?: string|null, after?: string, locale?: string}|null $texts */
        $texts = is_array($change['texts'] ?? null) && ($change['texts']['locale'] ?? config()->array('speedclub.locales')[0]) === $locale ? $change['texts'] : null;

        return $this->rendered(
            $kind,
            is_string($change['category'] ?? null) ? $change['category'] : null,
            is_string($change['modification_id'] ?? null) ? $change['modification_id'] : null,
            $texts['label'] ?? $label,
            $texts === null ? $beforeText : ($texts['before'] ?? null),
            $texts['after'] ?? $afterText,
            $details,
        );
    }

    /**
     * @param  array<array-key, mixed>  $snapshot
     */
    private function line(array $snapshot, ?ModCategory $category, string $locale): string
    {
        $title = is_string($snapshot['title'] ?? null) ? $snapshot['title'] : '';
        /** @var array<string, mixed> $fields */
        $fields = is_array($snapshot['fields'] ?? null) ? $snapshot['fields'] : [];

        return $category === null ? $title : $this->mods->summaryLine($title, $category, $fields, $locale);
    }

    /**
     * Field by field for VEH-05. Only where both sides exist; an added or removed mod has its line.
     *
     * @param  array<array-key, mixed>|null  $before
     * @param  array<array-key, mixed>|null  $after
     * @return list<Detail>
     */
    private function details(?array $before, ?array $after, ?ModCategory $category, string $locale): array
    {
        if ($before === null || $after === null || $category === null) {
            return [];
        }

        /** @var array<string, mixed> $old */
        $old = is_array($before['fields'] ?? null) ? $before['fields'] : [];
        /** @var array<string, mixed> $new */
        $new = is_array($after['fields'] ?? null) ? $after['fields'] : [];
        $details = [];

        if (($before['status'] ?? null) !== ($after['status'] ?? null)) {
            $details[] = [
                'label' => (string) __('garage.spec.status', [], $locale),
                'before' => $this->statusLabel($before['status'] ?? null, $locale),
                'after' => $this->statusLabel($after['status'] ?? null, $locale),
            ];
        }

        foreach ($category->fields->sortBy('sort') as $field) {
            /** @var ModCategoryField $field */
            /** @var string $key */
            $key = $field->getAttribute('key');

            if (($old[$key] ?? null) !== ($new[$key] ?? null)) {
                $details[] = [
                    'label' => $field->getTranslation('label', $locale),
                    'before' => isset($old[$key]) ? $this->mods->fieldValue($field, $old[$key], $locale) : null,
                    'after' => isset($new[$key]) ? $this->mods->fieldValue($field, $new[$key], $locale) : null,
                ];
            }
        }

        return $details;
    }

    private function statusLabel(mixed $status, string $locale): ?string
    {
        return is_string($status) ? ModStatus::tryFrom($status)?->label($locale) : null;
    }

    /**
     * @param  array<string, mixed>  $change
     * @return RenderedChange
     */
    private function specChange(array $change, PowerDisplay $display, string $locale): array
    {
        $field = is_string($change['field'] ?? null) ? $change['field'] : '';
        $format = fn (mixed $value): ?string => $this->specValue($field, $value, $display, $locale);

        return $this->rendered(
            BuildUpdateType::SpecsChanged->value,
            null,
            null,
            (string) __('garage.spec.'.$field, [], $locale),
            $format($change['before'] ?? null) ?? (string) __('garage.none', [], $locale),
            $format($change['after'] ?? null) ?? (string) __('garage.none', [], $locale),
        );
    }

    public function specValue(string $field, mixed $value, PowerDisplay $display, string $locale): ?string
    {
        if ($value === null) {
            return null;
        }

        return match ($field) {
            'power' => $this->powerValue($value, $display, $locale),
            'torque_nm' => is_numeric($value) ? Units::formatTorque((int) $value, $locale) : null,
            'displacement_cc' => is_numeric($value) ? Units::formatDisplacement((int) $value, $locale) : null,
            'fuel' => is_string($value) ? Fuel::tryFrom($value)?->label($locale) : null,
            'aspiration' => is_string($value) ? Aspiration::tryFrom($value)?->label($locale) : null,
            'drivetrain' => is_string($value) ? Drivetrain::tryFrom($value)?->label($locale) : null,
            'gearbox' => is_string($value) ? Gearbox::tryFrom($value)?->label($locale) : null,
            default => is_scalar($value) ? (string) $value : null,
        };
    }

    /**
     * "510 PS (375 kW) · Gemessen": a dyno run changes the provenance and not the number, and that has to read as a difference.
     */
    private function powerValue(mixed $value, PowerDisplay $display, string $locale): ?string
    {
        if (! is_array($value) || ! is_numeric($value['value'] ?? null) || ! is_string($value['unit'] ?? null)) {
            return null;
        }

        $unit = PowerUnit::tryFrom($value['unit']);

        if ($unit === null) {
            return null;
        }

        $power = Units::formatPower((float) $value['value'], $unit, $display, $locale);
        $source = is_string($value['source'] ?? null) ? PowerSource::tryFrom($value['source']) : null;

        return $source === null ? $power : $power.' · '.$source->label($locale);
    }

    /**
     * @param  array<string, mixed>  $change
     * @return RenderedChange
     */
    private function photoChange(array $change, string $locale): array
    {
        $count = is_numeric($change['count'] ?? null) ? (int) $change['count'] : 0;

        return $this->rendered(
            BuildUpdateType::PhotosAdded->value,
            null,
            null,
            (string) __('garage.photos_label', [], $locale),
            null,
            trans_choice('garage.photos_added', $count, ['count' => $count], $locale),
        );
    }

    /**
     * @param  list<Detail>  $details
     * @return RenderedChange
     */
    private function rendered(string $kind, ?string $category, ?string $modificationId, string $label, ?string $before, ?string $after, array $details = []): array
    {
        $line = $before === null ? (string) $after : $before.self::ARROW.$after;

        return [
            'kind' => $kind,
            'category' => $category,
            'modification_id' => $modificationId,
            'label' => $label,
            'before' => $before,
            'after' => $after,
            'text' => $label === '' ? $line : $label.': '.$line,
            'details' => $details,
        ];
    }
}
