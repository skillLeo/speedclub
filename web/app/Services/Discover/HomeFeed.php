<?php

namespace App\Services\Discover;

use App\Enums\FeaturedSource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehicleCompleteness;
use App\Services\Garage\VehiclePresenter;
use App\Services\Home\HomeCuration;
use App\Support\Slug;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Support\Collection;

/**
 * HOME-01 P1-lite, "Für dich" without ranking (02_PRODUCT_SPEC §3.8): the featured build and "Neue Builds". Guests and members get
 * the same lists, apart from blocks; "Folge ich" is Phase 2.
 */
class HomeFeed
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly VehicleCompleteness $completeness,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * The editorial list first, in its order, then the most complete public builds for the slots it leaves. Every slot has a
     * photo and a different owner. "Most complete" is VehicleCompleteness::percent, the share of the 13 items of the owner's
     * hint; ties go to the build changed last. The fallback looks at the speedclub.home.featured_candidates builds changed last,
     * so the hero stays fresh and the read stays bounded; rank_score stays for the ranking of Phase 2.
     *
     * @return list<FeaturedBuild>
     */
    public function featured(?User $viewer): array
    {
        $limit = config()->integer('speedclub.home.featured_limit');
        $slots = [];
        $owners = [];

        foreach ($this->editorial($viewer) as $vehicle) {
            if (count($slots) < $limit && ! isset($owners[$vehicle->owner_id]) && $this->hasPhoto($vehicle)) {
                $slots[] = new FeaturedBuild($vehicle, FeaturedSource::Editorial);
                $owners[$vehicle->owner_id] = true;
            }
        }

        if (count($slots) >= $limit) {
            return $slots;
        }

        $taken = array_map(fn (FeaturedBuild $slot): string => $slot->vehicle->id, $slots);

        foreach ($this->mostComplete($viewer, $taken) as $vehicle) {
            if (count($slots) < $limit && ! isset($owners[$vehicle->owner_id])) {
                $slots[] = new FeaturedBuild($vehicle, FeaturedSource::Completeness);
                $owners[$vehicle->owner_id] = true;
            }
        }

        return $slots;
    }

    /**
     * Recently published or changed public builds, newest first. A change to specs, mods or photos moves a build up
     * (vehicle_search.updated_at follows vehicles.updated_at, M1.6).
     *
     * @return CursorPaginator<int, Vehicle>
     */
    public function newBuilds(?User $viewer, int $perPage): CursorPaginator
    {
        $hits = $this->builds->query($viewer)->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at');

        return $this->builds->paginate($hits, ['sort_at' => 'desc', 'id' => 'desc'], $perPage);
    }

    /**
     * The configured builds the viewer may see in a list, in the configured order. A hidden one is skipped, never a 404.
     *
     * @return list<Vehicle>
     */
    private function editorial(?User $viewer): array
    {
        // ADM-29: the published Home curation, speedclub.home.featured_slugs while none is live (HomeCuration).
        $slugs = app(HomeCuration::class)->featuredSlugs();
        $publicIds = array_values(array_unique(array_filter(array_map(fn (string $slug): ?string => Slug::publicId($slug), $slugs))));

        if ($publicIds === []) {
            return [];
        }

        $ids = $this->builds->query($viewer, fromSearch: false)->whereIn('v.public_id', $publicIds)->pluck('v.public_id', 'v.id')->all();
        $vehicles = $this->builds->vehicles(array_map(strval(...), array_keys($ids)));
        $byPublicId = [];

        foreach ($vehicles as $vehicle) {
            $byPublicId[$vehicle->public_id] = $vehicle;
        }

        return array_values(array_filter(array_map(fn (string $publicId): ?Vehicle => $byPublicId[$publicId] ?? null, $publicIds)));
    }

    /**
     * @param  list<string>  $except
     * @return list<Vehicle>
     */
    private function mostComplete(?User $viewer, array $except): array
    {
        $ids = array_values($this->builds->query($viewer)
            ->when($except !== [], fn ($query) => $query->whereNotIn('vs.vehicle_id', $except))
            ->orderByDesc(VisibleBuilds::CHANGED_AT)
            ->orderByDesc('vs.vehicle_id')
            ->limit(config()->integer('speedclub.home.featured_candidates'))
            ->pluck('vs.vehicle_id')
            ->map(strval(...))
            ->all());

        $locale = app()->getLocale();
        $order = array_flip($ids);

        /** @var Collection<int, Vehicle> $candidates */
        $candidates = collect($this->builds->vehicles($ids))
            ->filter(fn (Vehicle $vehicle): bool => $this->hasPhoto($vehicle))
            ->values();
        $percent = $candidates->mapWithKeys(fn (Vehicle $vehicle): array => [$vehicle->id => $this->completeness->for($vehicle, $locale)['percent']])->all();

        return array_values($candidates
            ->sortBy([
                fn (Vehicle $a, Vehicle $b): int => $percent[$b->id] <=> $percent[$a->id],
                fn (Vehicle $a, Vehicle $b): int => $order[$a->id] <=> $order[$b->id],
            ])
            ->all());
    }

    /**
     * The hero is a photo (FS-2): a build whose last photo was deleted cannot fill it.
     */
    private function hasPhoto(Vehicle $vehicle): bool
    {
        return $vehicle->media->contains(fn ($media): bool => $this->presenter->photoVisibleTo($media, false));
    }
}
