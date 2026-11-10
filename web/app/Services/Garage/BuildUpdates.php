<?php

namespace App\Services\Garage;

use App\Enums\BuildUpdateType;
use App\Enums\ModStatus;
use App\Enums\PowerDisplay;
use App\Enums\VehicleStatus;
use App\Models\BuildUpdate;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Notifications\PublicationFanout;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Writes the build history (02_PRODUCT_SPEC §3.2). Changes of a published vehicle collect in one open update, for 10 minutes
 * after the last change, so a session of edits reads as one entry. A draft has no history yet: filling in the wizard is not news.
 *
 * What is stored is structured and free of language: `changes` holds snapshots, and BuildUpdatePresenter renders them per
 * viewer. Costs and notes are not in a snapshot, so they cannot reach the public Verlauf. label, before, after, category and
 * modification_id at the top describe the first change in German, for readers without the schema.
 *
 * @phpstan-type Change array<string, mixed>
 */
class BuildUpdates
{
    public function __construct(
        private readonly BuildUpdatePresenter $presenter,
        private readonly PublicationFanout $fanout,
    ) {}

    /**
     * @return array{title: string, status: string, fields: array<string, mixed>} the public face of a modification
     */
    public function snapshot(Modification $mod): array
    {
        /** @var array<string, mixed> $fields */
        $fields = $mod->getAttribute('fields') ?? [];
        ksort($fields);

        return [
            'title' => (string) $mod->getAttribute('title'),
            'status' => $mod->getAttribute('status') instanceof ModStatus ? $mod->getAttribute('status')->value : ModStatus::Installed->value,
            'fields' => $fields,
        ];
    }

    public function modAdded(Modification $mod): void
    {
        $this->record($mod->vehicle, $this->modChange(BuildUpdateType::ModAdded, $mod, null, $this->snapshot($mod)));
    }

    /**
     * @param  array{title: string, status: string, fields: array<string, mixed>}  $before  snapshot() before the edit
     * @return bool whether Verlauf now tells about this change; see record()
     */
    public function modChanged(Modification $mod, array $before): bool
    {
        $after = $this->snapshot($mod);

        return ! $this->same($before, $after) && $this->record($mod->vehicle, $this->modChange(BuildUpdateType::ModChanged, $mod, $before, $after));
    }

    public function modRemoved(Modification $mod): void
    {
        $this->record($mod->vehicle, $this->modChange(BuildUpdateType::ModRemoved, $mod, $this->snapshot($mod), null));
    }

    /**
     * @param  array<string, mixed>  $before  field => value, see specsSnapshot()
     * @param  array<string, mixed>  $after
     * @return bool whether Verlauf now tells about at least one of the changes; see record()
     */
    public function specsChanged(Vehicle $vehicle, array $before, array $after): bool
    {
        $recorded = false;

        foreach ($after as $field => $value) {
            if (! $this->sameSpec($field, $before[$field] ?? null, $value)) {
                $recorded = $this->record($vehicle, [
                    'kind' => BuildUpdateType::SpecsChanged->value,
                    'field' => $field,
                    'before' => $before[$field] ?? null,
                    'after' => $value,
                ]) || $recorded;
            }
        }

        return $recorded;
    }

    /**
     * Called per finished gallery photo. Nothing shows until three came together within the window; after that each further
     * one only raises the count of the update that is open. Photos count from publishing on, as a draft has no history, and
     * only once: what an earlier entry told about stays with it, also when the owner hid that entry.
     */
    public function photoAdded(Vehicle $vehicle): void
    {
        if ($vehicle->status !== VehicleStatus::Published) {
            return;
        }

        DB::transaction(function () use ($vehicle): void {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->first();

            $open = $this->open($vehicle, now());
            $hasPhotos = $open !== null && collect($this->changes($open))->contains('kind', BuildUpdateType::PhotosAdded->value);

            if ($hasPhotos) {
                $this->record($vehicle, $this->photosChange(1));

                return;
            }

            $recent = $vehicle->media()
                ->usablePhoto()
                ->where('created_at', '>=', now()->subMinutes(config()->integer('speedclub.garage.build_update_debounce_minutes')))
                ->when($vehicle->getAttribute('published_at'), fn ($query, mixed $publishedAt) => $query->where('created_at', '>=', $publishedAt))
                ->when($this->photosToldUntil($vehicle), fn ($query, CarbonInterface $until) => $query->where('created_at', '>', $until))
                ->count();

            if ($recent >= config()->integer('speedclub.garage.photos_for_build_update')) {
                $this->record($vehicle, $this->photosChange($recent));
            }
        });
    }

    /**
     * @return Change
     */
    private function photosChange(int $count): array
    {
        return ['kind' => BuildUpdateType::PhotosAdded->value, 'count' => $count, 'through' => now()->toIso8601String()];
    }

    /**
     * When the latest entry about photos took its last one, hidden or not.
     */
    private function photosToldUntil(Vehicle $vehicle): ?CarbonInterface
    {
        $latest = BuildUpdate::query()
            ->where('vehicle_id', $vehicle->id)
            ->whereJsonContains('payload->changes', ['kind' => BuildUpdateType::PhotosAdded->value])
            ->latest('created_at')
            ->latest('id')
            ->first();

        if ($latest === null) {
            return null;
        }

        $through = collect($this->changes($latest))->firstWhere('kind', BuildUpdateType::PhotosAdded->value)['through'] ?? null;

        return is_string($through) ? Carbon::parse($through) : $latest->created_at;
    }

    /**
     * An owner note is its own entry and never merges.
     */
    public function note(Vehicle $vehicle, string $text, ?CarbonInterface $at = null, bool $hidden = false): BuildUpdate
    {
        $update = new BuildUpdate(['type' => BuildUpdateType::Note, 'note' => $text, 'hidden' => $hidden]);
        $update->forceFill(['vehicle_id' => $vehicle->id, 'created_at' => $at ?? now()])->save();

        return $update;
    }

    /**
     * For imported and demo history: a backdated entry of its own, with the wording its author gave.
     *
     * @param  array{label: string, before: string|null, after: string}|null  $texts
     */
    public function backdated(Modification $mod, BuildUpdateType $type, CarbonInterface $at, ?array $texts = null): BuildUpdate
    {
        $snapshot = $this->snapshot($mod);
        $change = $this->modChange($type, $mod, $type === BuildUpdateType::ModAdded ? null : $snapshot, $type === BuildUpdateType::ModRemoved ? null : $snapshot);

        if ($texts !== null) {
            $change['texts'] = $texts;
        }

        $update = new BuildUpdate(['type' => $type, 'payload' => $this->payload([$change])]);
        $update->forceFill(['vehicle_id' => $mod->getAttribute('vehicle_id'), 'created_at' => $at])->save();

        return $update;
    }

    /**
     * Whether Verlauf tells about this change afterwards: false on a draft, and for a value changed back within the window, which
     * leaves nothing to show.
     *
     * @param  Change  $change
     */
    private function record(Vehicle $vehicle, array $change): bool
    {
        if ($vehicle->status !== VehicleStatus::Published) {
            return false;
        }

        return DB::transaction(function () use ($vehicle, $change): bool {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->first();

            $now = now();
            $open = $this->open($vehicle, $now);
            $changes = $this->merged($open === null ? [] : $this->changes($open), $change);
            $openUntil = $now->copy()->addMinutes(config()->integer('speedclub.garage.build_update_debounce_minutes'));

            if ($changes === []) {
                $open?->delete();

                return false;
            }

            $told = collect($changes)->contains(fn (array $entry): bool => $this->key($entry) === $this->key($change));

            // A full entry stops taking changes, which bounds both what a row costs to read and to rewrite.
            if ($open !== null && count($changes) > config()->integer('speedclub.garage.build_update_max_changes')) {
                $open->forceFill(['open_until' => null])->save();
                $open = null;
                $changes = [$change];
                $told = true;
            }

            $type = BuildUpdateType::from((string) $changes[0]['kind']);

            if ($open === null) {
                $update = new BuildUpdate(['type' => $type, 'payload' => $this->payload($changes)]);
                $update->forceFill(['vehicle_id' => $vehicle->id, 'created_at' => $now, 'open_until' => $openUntil])->save();
                // A new entry of Verlauf is news for followers; changes that join it within the window are not news again.
                $this->fanout->updateCreated($update);

                return $told;
            }

            $open->forceFill(['type' => $type, 'payload' => $this->payload($changes), 'open_until' => $openUntil])->save();

            return $told;
        });
    }

    /**
     * The update still taking changes. Once the owner hid it, later changes start a new one.
     */
    private function open(Vehicle $vehicle, CarbonInterface $now): ?BuildUpdate
    {
        return BuildUpdate::query()
            ->where('vehicle_id', $vehicle->id)
            ->where('hidden', false)
            ->where('open_until', '>', $now)
            ->latest('created_at')
            ->latest('id')
            ->first();
    }

    /**
     * @return list<Change>
     */
    private function changes(BuildUpdate $update): array
    {
        /** @var list<Change> $changes */
        $changes = $update->payload['changes'] ?? [];

        return $changes;
    }

    /**
     * One entry per modification, spec field and for photos: the earliest "before" and the latest "after" count. Added and
     * removed in the same window never happened, and a value changed back has nothing to show.
     *
     * @param  list<Change>  $changes
     * @param  Change  $change
     * @return list<Change>
     */
    private function merged(array $changes, array $change): array
    {
        $key = $this->key($change);

        foreach ($changes as $index => $existing) {
            if ($this->key($existing) !== $key) {
                continue;
            }

            if ($change['kind'] === BuildUpdateType::PhotosAdded->value) {
                $changes[$index]['count'] = (int) $existing['count'] + (int) $change['count'];
                $changes[$index]['through'] = $change['through'];

                return $changes;
            }

            $removedAgain = $existing['kind'] === BuildUpdateType::ModAdded->value && $change['kind'] === BuildUpdateType::ModRemoved->value;
            $combined = [
                ...$change,
                'kind' => $existing['kind'] === BuildUpdateType::ModAdded->value ? $existing['kind'] : $change['kind'],
                'before' => $existing['before'] ?? null,
            ];

            $backAgain = $change['kind'] === BuildUpdateType::SpecsChanged->value
                ? $this->sameSpec((string) $change['field'], $combined['before'], $combined['after'])
                : $this->same($combined['before'], $combined['after']);

            if ($removedAgain || $backAgain) {
                unset($changes[$index]);

                return array_values($changes);
            }

            $changes[$index] = $combined;

            return $changes;
        }

        $changes[] = $change;

        return $changes;
    }

    /**
     * As they will be stored: JSON makes 400.0 and 400 the same number, and PHP would not. A JSON column also hands its objects back
     * in an order of its own, and a change that went back to the start is still no change.
     */
    private function same(mixed $first, mixed $second): bool
    {
        return json_encode($this->sortedKeys($first)) === json_encode($this->sortedKeys($second));
    }

    private function sortedKeys(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        ksort($value);

        return array_map($this->sortedKeys(...), $value);
    }

    /**
     * What a viewer could tell apart: 510 PS and 375 kW are the same power entered in another unit, in every display setting.
     */
    private function sameSpec(string $field, mixed $first, mixed $second): bool
    {
        if ($field !== 'power') {
            return $this->same($first, $second);
        }

        foreach (PowerDisplay::cases() as $display) {
            if ($this->presenter->specValue($field, $first, $display, 'de') !== $this->presenter->specValue($field, $second, $display, 'de')) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param  Change  $change
     */
    private function key(array $change): string
    {
        return match ($change['kind']) {
            BuildUpdateType::SpecsChanged->value => 'spec:'.$change['field'],
            BuildUpdateType::PhotosAdded->value => 'photos',
            default => 'mod:'.$change['modification_id'],
        };
    }

    /**
     * @param  array{title: string, status: string, fields: array<string, mixed>}|null  $before
     * @param  array{title: string, status: string, fields: array<string, mixed>}|null  $after
     * @return Change
     */
    private function modChange(BuildUpdateType $type, Modification $mod, ?array $before, ?array $after): array
    {
        return [
            'kind' => $type->value,
            'category' => $mod->category->key,
            'modification_id' => $mod->getKey(),
            'before' => $before,
            'after' => $after,
        ];
    }

    /**
     * @param  list<Change>  $changes
     * @return array<string, mixed>
     */
    private function payload(array $changes): array
    {
        $first = $this->presenter->renderChange($changes[0], PowerDisplay::PsKw, 'de');

        return [
            'label' => $first['label'],
            'before' => $first['before'],
            'after' => $first['after'],
            'category' => $changes[0]['category'] ?? null,
            'modification_id' => $changes[0]['modification_id'] ?? null,
            'changes' => $changes,
        ];
    }
}
