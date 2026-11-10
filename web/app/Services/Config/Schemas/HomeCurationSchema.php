<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Enums\SearchSort;
use App\Models\DiscoverCollection;
use App\Models\Vehicle;
use App\Services\Discover\StoredFilterRules;
use App\Support\Slug;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * `home_curation` (ADM-29, replaces speedclub.home.featured_slugs as the source, ADR-190; that list stays the fallback):
 * - featured: [{vehicle_id, starts_at, ends_at}] in order, at most speedclub.content.featured_live_max live at any moment;
 * - collections: [{key, title, subtitle: {de, en}, mode: filter|vehicles, filters (the DISC-02 parameters, StoredFilterRules), sort,
 *   vehicle_ids (hand-picked), cover_vehicle_id, active}] in order.
 * Publishing syncs the `collections` rows DISC-01 reads (App\Services\Discover\Collections): one per key, in this order, a key no longer
 * listed is deactivated. A hand-picked collection is stored but stays inactive there until DISC-01/02 can list a set of builds (open
 * issue of M3.5).
 */
final class HomeCurationSchema extends Schema
{
    public function __construct(private readonly StoredFilterRules $filters) {}

    public function key(): ConfigKey
    {
        return ConfigKey::HomeCuration;
    }

    public function normalize(array $payload): array
    {
        $data = Validator::make($payload, [
            'featured' => ['present', 'array', 'list', 'max:'.config()->integer('speedclub.content.featured_max')],
            'featured.*.vehicle_id' => ['required', 'string', 'ulid'],
            'featured.*.starts_at' => ['nullable', 'date'],
            'featured.*.ends_at' => ['nullable', 'date'],
            'collections' => ['present', 'array', 'list', 'max:'.config()->integer('speedclub.content.collections_max')],
            'collections.*.key' => ['required', 'string', 'regex:/\A[a-z0-9][a-z0-9-]{0,59}\z/', 'distinct'],
            ...$this->localizedRules('collections.*.title', true, 60),
            ...$this->localizedRules('collections.*.subtitle', false, 120),
            'collections.*.mode' => ['required', Rule::in(['filter', 'vehicles'])],
            'collections.*.filters' => ['nullable', 'array'],
            'collections.*.sort' => ['nullable', Rule::enum(SearchSort::class)],
            'collections.*.vehicle_ids' => ['nullable', 'array', 'list', 'max:'.config()->integer('speedclub.content.collection_vehicles_max')],
            'collections.*.vehicle_ids.*' => ['string', 'ulid'],
            'collections.*.cover_vehicle_id' => ['nullable', 'string', 'ulid'],
            'collections.*.active' => ['required', 'boolean'],
        ])->validate();

        $errors = [];
        $featured = [];

        foreach ($data['featured'] as $index => $entry) {
            $starts = $this->date($entry['starts_at'] ?? null);
            $ends = $this->date($entry['ends_at'] ?? null);

            if ($starts !== null && $ends !== null && $ends <= $starts) {
                $errors["featured.$index.ends_at"] = (string) __('content.home.ends_before_start');
            }

            $featured[] = ['vehicle_id' => strtolower((string) $entry['vehicle_id']), 'starts_at' => $starts, 'ends_at' => $ends];
        }

        $collections = [];

        foreach ($data['collections'] as $index => $entry) {
            $mode = (string) $entry['mode'];
            $filters = is_array($entry['filters'] ?? null) ? $entry['filters'] : [];
            $vehicles = array_values(array_unique(array_map(fn (string $id): string => strtolower($id), $entry['vehicle_ids'] ?? [])));

            if ($mode === 'filter' && ($filters === [] || ! $this->filters->passes($filters))) {
                $errors["collections.$index.filters"] = (string) __('content.home.filters');
            }

            if ($mode === 'vehicles' && $vehicles === []) {
                $errors["collections.$index.vehicle_ids"] = (string) __('content.home.vehicles');
            }

            $collections[] = [
                'key' => (string) $entry['key'],
                'title' => $this->localized($entry['title']),
                'subtitle' => $this->localized($entry['subtitle'] ?? null),
                'mode' => $mode,
                'filters' => $mode === 'filter' ? $filters : [],
                'sort' => $entry['sort'] ?? null,
                'vehicle_ids' => $mode === 'vehicles' ? $vehicles : [],
                'cover_vehicle_id' => isset($entry['cover_vehicle_id']) ? strtolower((string) $entry['cover_vehicle_id']) : null,
                'active' => (bool) $entry['active'],
            ];
        }

        $ids = array_unique([
            ...array_column($featured, 'vehicle_id'),
            ...array_merge([], ...array_column($collections, 'vehicle_ids')),
            ...array_filter(array_column($collections, 'cover_vehicle_id')),
        ]);
        $reachable = Vehicle::query()->whereKey($ids)->get()->filter(fn (Vehicle $vehicle): bool => $vehicle->isReachable())->modelKeys();

        foreach ($featured as $index => $entry) {
            if (! in_array($entry['vehicle_id'], $reachable, true)) {
                $errors["featured.$index.vehicle_id"] = (string) __('content.home.vehicle_missing');
            }
        }

        foreach ($collections as $index => $entry) {
            foreach ([...$entry['vehicle_ids'], ...array_filter([$entry['cover_vehicle_id']])] as $id) {
                if (! in_array($id, $reachable, true)) {
                    $errors["collections.$index.vehicle_ids"] = (string) __('content.home.vehicle_missing');
                }
            }
        }

        $peak = $this->peakLive($featured);

        if ($peak > config()->integer('speedclub.content.featured_live_max')) {
            $errors['featured'] = (string) __('content.home.too_many_live', ['max' => config()->integer('speedclub.content.featured_live_max'), 'count' => $peak]);
        }

        if ($errors !== []) {
            $this->refuse($errors);
        }

        return ['featured' => $featured, 'collections' => $collections];
    }

    public function initial(): array
    {
        $featured = [];
        $publicIds = array_values(array_filter(array_map(
            fn (mixed $slug): ?string => is_string($slug) ? Slug::publicId($slug) : null,
            config()->array('speedclub.home.featured_slugs'),
        )));

        if ($publicIds !== []) {
            $byPublicId = Vehicle::query()->whereIn('public_id', $publicIds)->pluck('id', 'public_id')->all();

            foreach ($publicIds as $publicId) {
                if (isset($byPublicId[$publicId])) {
                    $featured[] = ['vehicle_id' => (string) $byPublicId[$publicId], 'starts_at' => null, 'ends_at' => null];
                }
            }
        }

        $collections = [];

        foreach (DiscoverCollection::query()->orderBy('position')->orderBy('id')->get() as $row) {
            $sort = $row->getRawOriginal('sort');
            $collections[] = [
                'key' => $row->key,
                'title' => ['de' => (string) $row->getTranslation('title', 'de'), 'en' => $row->getTranslation('title', 'en', false) ?: null],
                'subtitle' => $this->localized(['de' => $row->getTranslation('subtitle', 'de', false), 'en' => $row->getTranslation('subtitle', 'en', false)]),
                'mode' => 'filter',
                'filters' => $row->filters,
                'sort' => is_string($sort) ? $sort : null,
                'vehicle_ids' => [],
                'cover_vehicle_id' => $row->getAttribute('cover_vehicle_id'),
                'active' => (bool) $row->getAttribute('active'),
            ];
        }

        return ['featured' => $featured, 'collections' => $collections];
    }

    public function published(array $payload): void
    {
        /** @var list<array<string, mixed>> $collections */
        $collections = is_array($payload['collections'] ?? null) ? $payload['collections'] : [];
        $keys = [];

        foreach ($collections as $position => $entry) {
            $key = (string) $entry['key'];
            $keys[] = $key;
            $row = DiscoverCollection::query()->firstOrNew(['key' => $key]);
            $title = is_array($entry['title'] ?? null) ? array_filter($entry['title'], is_string(...)) : [];
            $subtitle = is_array($entry['subtitle'] ?? null) ? array_filter($entry['subtitle'], is_string(...)) : [];

            $row->setTranslations('title', $title);
            $row->setTranslations('subtitle', $subtitle);
            $row->fill([
                'filters' => is_array($entry['filters'] ?? null) ? $entry['filters'] : [],
                'sort' => $entry['sort'] ?? null,
                'position' => $position,
                'cover_vehicle_id' => $entry['cover_vehicle_id'] ?? null,
                // Hand-picked sets have no reader in DISC-01 yet: kept, not shown.
                'active' => ($entry['active'] ?? false) === true && ($entry['mode'] ?? null) === 'filter',
            ])->save();
        }

        DiscoverCollection::query()->whereNotIn('key', $keys === [] ? [''] : $keys)->update(['active' => false]);
    }

    /**
     * The most featured entries live at one moment: a sweep over the start and end points (open ends reach ±∞).
     *
     * @param  list<array{vehicle_id: string, starts_at: string|null, ends_at: string|null}>  $featured
     */
    private function peakLive(array $featured): int
    {
        $points = [];

        foreach ($featured as $entry) {
            $points[] = [$entry['starts_at'] === null ? PHP_INT_MIN : Carbon::parse($entry['starts_at'])->getTimestamp(), 1];
            $points[] = [$entry['ends_at'] === null ? PHP_INT_MAX : Carbon::parse($entry['ends_at'])->getTimestamp(), -1];
        }

        // An end and a start at the same second do not overlap: ends first.
        usort($points, fn (array $a, array $b): int => $a[0] <=> $b[0] ?: $a[1] <=> $b[1]);
        $live = 0;
        $peak = 0;

        foreach ($points as [, $step]) {
            $live += $step;
            $peak = max($peak, $live);
        }

        return $peak;
    }
}
