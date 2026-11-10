<?php

namespace App\Services\Discover;

use App\Enums\SearchSort;
use App\Models\DiscoverCollection;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;

/**
 * "Kollektionen" of DISC-01 (m2.3 contract §5): the active rows of `collections` in their order, each with the real number of builds the
 * viewer can find with its filters. A collection whose filters match no visible build, no longer resolve (a catalogue entry the admin
 * removed) or do not pass the DISC-02 parameter rules (a value of the wrong type, M2.3 review #10) is left out; an unknown stored sort is
 * read as none. The cover is the chosen build's cover when that build is visible and in the collection, else the cover of the
 * collection's build changed last that has a visible photo; null only when none of them has one.
 *
 * Queries: per collection the slug lookups, its count and its cover candidates; the candidates' vehicles of all collections are then read
 * at once (M2.3 review #9).
 */
final class Collections
{
    /** Builds looked at for a cover. */
    private const COVER_CANDIDATES = 6;

    public function __construct(
        private readonly TextSearch $search,
        private readonly SearchFilterResolver $resolver,
        private readonly VehiclePresenter $presenter,
        private readonly StoredFilterRules $rules,
    ) {}

    /**
     * @return list<CollectionCard>
     */
    public function for(?User $viewer): array
    {
        $found = [];
        $rows = DiscoverCollection::query()->where('active', true)->orderBy('position')->orderBy('id')
            ->limit(config()->integer('speedclub.discover.collections'))
            ->get();

        foreach ($rows as $collection) {
            /** @var mixed $stored */
            $stored = $collection->getAttribute('filters');

            if (! is_array($stored) || ! $this->rules->passes($stored)) {
                continue;
            }

            $resolved = $this->resolver->resolve($stored);

            if ($resolved['errors'] !== []) {
                continue;
            }

            $filters = $resolved['filters'];
            $count = $this->search->countVehicles($viewer, null, $filters);

            if ($count->count === 0) {
                continue;
            }

            $found[] = [$collection, $filters, $count, $this->coverCandidates($viewer, $filters, $collection->getAttribute('cover_vehicle_id'))];
        }

        $ids = array_values(array_unique(array_merge([], ...array_map(fn (array $entry): array => $entry[3], $found))));
        $vehicles = $ids === [] ? collect() : Vehicle::query()->whereKey($ids)->with(['cover', 'media'])->get()->keyBy('id');
        $locale = app()->getLocale();
        $cards = [];

        foreach ($found as [$collection, $filters, $count, $candidates]) {
            $subtitle = $collection->getTranslation('subtitle', $locale);
            $sort = $collection->getRawOriginal('sort');

            $cards[] = new CollectionCard(
                key: $collection->key,
                title: (string) $collection->getTranslation('title', $locale),
                subtitle: is_string($subtitle) && $subtitle !== '' ? $subtitle : null,
                cover: $this->cover($candidates, $vehicles->all()),
                filters: $filters->params(),
                sort: is_string($sort) ? SearchSort::tryFrom($sort) : null,
                count: $count->count,
                countCapped: $count->capped,
            );
        }

        return $cards;
    }

    /**
     * The chosen build first when it is visible and in the collection, then the builds changed last: one query.
     *
     * @return list<string>
     */
    private function coverCandidates(?User $viewer, SearchFilters $filters, mixed $chosen): array
    {
        $query = $this->search->matching($viewer, null, $filters);

        if (is_string($chosen)) {
            $query->orderByRaw('CASE WHEN vs.vehicle_id = ? THEN 0 ELSE 1 END', [$chosen]);
        }

        return array_values($query
            ->orderByDesc(VisibleBuilds::CHANGED_AT)->orderByDesc('vs.vehicle_id')
            ->limit(self::COVER_CANDIDATES)
            ->pluck('vs.vehicle_id')
            ->map(strval(...))
            ->all());
    }

    /**
     * @param  list<string>  $candidates
     * @param  array<array-key, Vehicle>  $vehicles
     */
    private function cover(array $candidates, array $vehicles): ?Media
    {
        foreach ($candidates as $id) {
            $vehicle = $vehicles[$id] ?? null;
            $cover = $vehicle instanceof Vehicle ? $this->presenter->cover($vehicle, false) : null;

            if ($cover !== null) {
                return $cover;
            }
        }

        return null;
    }
}
