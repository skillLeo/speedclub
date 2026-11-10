<?php

namespace App\Services\Search;

use App\Enums\ModStatus;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Discover\SearchFilterResolver;
use App\Services\Home\HomeRanking;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * vehicle_search (05_ARCHITECTURE §6, §10). Always rebuilds from the current rows, so running it twice or out of order ends in
 * the same place. A row exists for every published vehicle; is_public says whether search and feeds may show it. Only what
 * others may read goes into search_text: no notes, no costs. rank_score belongs to the ranking of Für dich (02_PRODUCT_SPEC §3.8, M2.2):
 * a new row gets its score here, an existing row keeps its score until the hourly home:rank, so the stream's order holds within the hour. title_keys and search_keys are search_text in the form of SearchTerms;
 * search_keys stop at speedclub.search.keys_max_bytes.
 *
 * mod_category_mask: bit 1 << (mod_categories.sort - 1) for every category with an installed modification. vehicle_search_facets (M2.3):
 * one row per installed wheel diameter, wheel, suspension and exhaust brand and suspension type, for the DISC-02 filters and facets; the
 * single columns wheel_diameter, wheel_brand_id, … keep the first part of each category, as the vehicle page shows it.
 */
class VehicleSearchProjector
{
    public function __construct(private readonly HomeRanking $ranking) {}

    /** The TEXT column holds 65,535 bytes. */
    private const MAX_SEARCH_TEXT_BYTES = 60_000;

    /** title_keys is a VARCHAR(1000) of ASCII. */
    private const MAX_TITLE_KEYS_BYTES = 1000;

    /**
     * After a commit, for everything that is not about privacy. The dispatch itself waits for the commit: it takes the job's
     * uniqueness, which a rollback would otherwise leave held with no job behind it.
     */
    public function queue(Vehicle $vehicle): void
    {
        if ($vehicle->status === VehicleStatus::Published && ! $vehicle->trashed()) {
            DB::afterCommit(fn () => RebuildVehicleSearch::dispatch($vehicle->id));
        }
    }

    /**
     * Something that belongs to the vehicle changed (specs, a modification, a photo). "Zuletzt aktualisiert" (02_PRODUCT_SPEC §3.7)
     * reads vehicles.updated_at, which only follows writes to the row itself otherwise.
     */
    public function changed(Vehicle $vehicle): void
    {
        if (! $vehicle->trashed()) {
            $vehicle->touch();
            $this->queue($vehicle);
        }
    }

    /**
     * Under the vehicle's row lock, which a privacy change or delete also holds until it commits. So a queued rebuild either
     * finishes before those, which then write over it, or waits and reads what they committed: it cannot write an older state back.
     */
    public function rebuild(string $vehicleId): void
    {
        DB::transaction(function () use ($vehicleId): void {
            $vehicle = Vehicle::withTrashed()
                ->with(['owner', 'make', 'vehicleModel', 'generation', 'specs', 'modifications.brand', 'modifications.category.fields'])
                ->whereKey($vehicleId)
                ->lockForUpdate()
                ->first();

            if ($vehicle === null || $vehicle->trashed() || $vehicle->status !== VehicleStatus::Published) {
                $this->remove($vehicleId);

                return;
            }

            $row = VehicleSearch::query()->firstOrNew(['vehicle_id' => $vehicle->id]);
            $row->fill($this->row($vehicle));
            // When the vehicle changed, not when this ran: a rebuild changes nothing about the build. Never null, as "Neue Builds"
            // orders and pages on this column alone, through its index (is_public, updated_at).
            $row->timestamps = false;
            $row->setAttribute('updated_at', $vehicle->getAttribute('updated_at') ?? $vehicle->getAttribute('published_at') ?? $vehicle->getAttribute('created_at') ?? now());
            $row->save();
            $this->writeFacets($row, $vehicle);

            if ($row->wasRecentlyCreated) {
                $this->ranking->rank($vehicle->id);
            }
        });
    }

    /**
     * Gone from search at once, inside the caller's request.
     */
    public function remove(string $vehicleId): void
    {
        VehicleSearch::query()->whereKey($vehicleId)->delete();
    }

    /**
     * Every vehicle, for the artisan command and the seeder. Returns how many rows exist afterwards.
     */
    public function rebuildAll(): int
    {
        VehicleSearch::query()
            ->whereNotIn('vehicle_id', Vehicle::query()->where('status', VehicleStatus::Published)->select('id'))
            ->delete();

        $count = 0;

        Vehicle::query()->where('status', VehicleStatus::Published)->select('id')->chunkById(200, function (Collection $vehicles) use (&$count): void {
            foreach ($vehicles as $vehicle) {
                /** @var Vehicle $vehicle */
                $this->rebuild($vehicle->id);
                $count++;
            }
        });

        // "Also after each search rebuild" (M2.2): the full rebuild is when every score is current again.
        $this->ranking->rankAll();

        return $count;
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Vehicle $vehicle): array
    {
        // In the member's order, as the vehicle page reads them: "first wheels" must be the same set in both.
        /** @var Collection<int, Modification> $installed */
        $installed = $vehicle->modifications->where('status', ModStatus::Installed)->sortBy([['sort', 'asc'], ['id', 'asc']])->values();

        $wheels = $this->firstIn($installed, 'wheels_tires', fn (Modification $mod): bool => isset($mod->getAttribute('fields')['diameter']));
        $suspension = $this->firstIn($installed, 'suspension');
        $exhaust = $this->firstIn($installed, 'exhaust');
        $owner = $vehicle->owner;

        return [
            'owner_id' => $vehicle->owner_id,
            'make_id' => $vehicle->getAttribute('make_id'),
            'model_id' => $vehicle->getAttribute('model_id'),
            'generation_id' => $vehicle->getAttribute('generation_id'),
            'model_year' => $vehicle->model_year,
            'power_ps' => $vehicle->specs?->power_ps,
            'drivetrain' => $vehicle->specs?->getAttribute('drivetrain'),
            'gearbox' => $vehicle->specs?->getAttribute('gearbox'),
            'fuel' => $vehicle->specs?->getAttribute('fuel'),
            'wheel_diameter' => $wheels?->getAttribute('fields')['diameter'] ?? null,
            'wheel_brand_id' => $wheels?->getAttribute('brand_id'),
            'suspension_type' => $suspension?->getAttribute('fields')['type'] ?? null,
            'suspension_brand_id' => $suspension?->getAttribute('brand_id'),
            'exhaust_brand_id' => $exhaust?->getAttribute('brand_id'),
            'mod_category_mask' => $this->mask($installed),
            'search_text' => mb_strcut(implode(' ', $parts = $this->searchParts($vehicle, $installed)), 0, self::MAX_SEARCH_TEXT_BYTES),
            'title_keys' => SearchTerms::keys($this->titleParts($vehicle), self::MAX_TITLE_KEYS_BYTES),
            // Each part as a phrase of its own, so no phrase limit cuts a long list of mods short (SEC-M18-02). Bounded, as every
            // search reads the keys of every public build (SEC-M18-01).
            'search_keys' => SearchTerms::keys($parts, config()->integer('speedclub.search.keys_max_bytes')),
            'is_public' => $vehicle->visibility === Visibility::Public && $owner !== null && $owner->isPubliclyVisible(),
            'published_at' => $vehicle->getAttribute('published_at'),
        ];
    }

    /**
     * The facet rows of M2.3 (vehicle_search_facets): every installed part, not just the first of its category. Replaced as a whole, in
     * the transaction of the row itself.
     */
    private function writeFacets(VehicleSearch $row, Vehicle $vehicle): void
    {
        $table = fn () => $row->getConnection()->table('vehicle_search_facets');
        $table()->where('vehicle_id', $vehicle->id)->delete();
        $rows = [];

        foreach ($this->facets($vehicle) as $facet => $values) {
            foreach (array_unique($values) as $value) {
                $rows[] = ['vehicle_id' => $vehicle->id, 'facet' => $facet, 'value' => $value];
            }
        }

        if ($rows !== []) {
            $table()->insert($rows);
        }
    }

    /**
     * Wheel diameters (front and rear, ADR-112), the brands of wheels, suspension and exhaust (after a merge, the brand merged into) and
     * the suspension types, of installed mods.
     *
     * @return array<string, list<string>>
     */
    public function facets(Vehicle $vehicle): array
    {
        $facets = [];
        $brandFacets = ['wheels_tires' => 'wheel_brand', 'suspension' => 'suspension_brand', 'exhaust' => 'exhaust_brand'];

        foreach ($vehicle->modifications->where('status', ModStatus::Installed) as $mod) {
            /** @var Modification $mod */
            $key = $mod->category->key;
            /** @var array<string, mixed> $fields */
            $fields = $mod->getAttribute('fields') ?? [];

            if (isset($brandFacets[$key]) && $mod->getAttribute('brand_id') !== null) {
                $facets[$brandFacets[$key]][] = (string) ($mod->brand?->getAttribute('merged_into_id') ?? $mod->getAttribute('brand_id'));
            }

            if ($key === 'wheels_tires') {
                foreach (['diameter', 'diameter_rear'] as $field) {
                    $inches = $fields[$field] ?? null;

                    if (is_numeric($inches) && (float) $inches >= 13 && (float) $inches <= 24) {
                        $facets['wheel_diameter'][] = SearchFilterResolver::diameter((float) $inches);
                    }
                }
            }

            if ($key === 'suspension' && is_string($fields['type'] ?? null) && $fields['type'] !== '') {
                $facets['suspension_type'][] = $fields['type'];
            }
        }

        return $facets;
    }

    /**
     * @param  Collection<int, Modification>  $mods
     * @param  (callable(Modification): bool)|null  $and
     */
    private function firstIn(Collection $mods, string $category, ?callable $and = null): ?Modification
    {
        return $mods->first(fn (Modification $mod): bool => $mod->category->key === $category && ($and === null || $and($mod)));
    }

    /**
     * @param  Collection<int, Modification>  $mods
     */
    private function mask(Collection $mods): int
    {
        $mask = 0;

        foreach ($mods as $mod) {
            /** @var ModCategory $category */
            $category = $mod->category;
            /** @var int $sort */
            $sort = $category->getAttribute('sort');

            if ($sort >= 1) {
                $mask |= 1 << ($sort - 1);
            }
        }

        return $mask;
    }

    /**
     * Make, model, generation, nickname, description, engine code, mod titles, brands, parts and the fields the schema marks
     * as searchable (02_PRODUCT_SPEC §3.7), each once, in this order: what names the car, the description, then the mods in the
     * member's order. A build with more words than the keys hold loses the words of its last mods.
     *
     * @param  Collection<int, Modification>  $mods
     * @return list<string>
     */
    private function searchParts(Vehicle $vehicle, Collection $mods): array
    {
        $text = [...$this->titleParts($vehicle), $vehicle->getAttribute('description')];

        foreach ($mods as $mod) {
            $text[] = $mod->getAttribute('title');
            $text[] = $mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text');
            $text[] = $mod->getAttribute('part_name');

            /** @var array<string, mixed> $fields */
            $fields = $mod->getAttribute('fields') ?? [];

            foreach ($mod->category->fields as $field) {
                $value = $fields[$field->getAttribute('key')] ?? null;

                if ($field->getAttribute('searchable') === true && is_string($value)) {
                    $text[] = $value;
                }
            }
        }

        return array_values(array_unique(array_filter($text, fn (mixed $part): bool => is_string($part) && $part !== '')));
    }

    /**
     * What names the car, weighted above the rest in the relevance of M1.8: make, model, generation, nickname, engine code.
     *
     * @return list<string|null>
     */
    private function titleParts(Vehicle $vehicle): array
    {
        return [
            $vehicle->make->name ?? $vehicle->getAttribute('make_text'),
            $vehicle->vehicleModel->name ?? $vehicle->getAttribute('model_text'),
            $vehicle->generation?->name,
            $vehicle->getAttribute('nickname'),
            $vehicle->specs?->getAttribute('engine_code'),
        ];
    }
}
