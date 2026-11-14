<?php

namespace App\Services\Businesses;

use App\Enums\BusinessStatus;
use App\Enums\UserStatus;
use App\Models\Business;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Garage\VehiclePresenter;
use App\Services\Parts\PartBuilds;
use App\Services\Showcase\SampleContent;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The businesses a viewer may see in a list (09 §7.5 Betriebe scope, Home "Werkstätten in deiner Nähe"): verified, not removed, owner
 * active and verified, no block with the owner, samples only while shown — BusinessPolicy::view for a whole query. And the portfolio
 * of one business ("Builds aus unserer Werkstatt"): visible builds with a mod whose tag both sides confirmed.
 */
final class BusinessListing
{
    public function __construct(
        private readonly SampleContent $samples,
        private readonly VisibleBuilds $builds,
    ) {}

    /**
     * @return Builder<Business>
     */
    public function visible(?User $viewer): Builder
    {
        $query = Business::query()
            ->where('businesses.status', BusinessStatus::Verified->value)
            ->whereNull('businesses.removed_at')
            ->whereHas('owner', fn (Builder $owner) => $owner->where('status', UserStatus::Active->value)->whereNotNull('email_verified_at'));

        $this->samples->constrain($query->getQuery(), 'businesses.is_sample');

        if (! $this->samples->visible()) {
            $query->whereHas('owner', fn (Builder $owner) => $owner->where('is_sample', false));
        }

        if ($viewer !== null) {
            $query->whereNotExists(fn (QueryBuilder $mine) => $mine->selectRaw('1')->from('blocks', 'b')->where('b.blocker_id', $viewer->id)->whereColumn('b.blocked_id', 'businesses.owner_id'))
                ->whereNotExists(fn (QueryBuilder $theirs) => $theirs->selectRaw('1')->from('blocks', 'bt')->whereColumn('bt.blocker_id', 'businesses.owner_id')->where('bt.blocked_id', $viewer->id));
        }

        return $query;
    }

    /**
     * @param  array{q: string|null, city: string|null, kind: string|null, service: string|null, lat: float|null, lng: float|null, radius_km: int}  $filters
     * @return CursorPaginator<int, Business>
     */
    public function page(?User $viewer, array $filters, int $perPage): CursorPaginator
    {
        $query = $this->visible($viewer)->with(['logo', 'cover', 'owner']);

        if ($filters['q'] !== null) {
            $like = '%'.addcslashes($filters['q'], '%_\\').'%';
            $query->where(fn (Builder $any) => $any->where('businesses.name', 'like', $like)->orWhere('businesses.city', 'like', $like)->orWhere('businesses.services', 'like', $like));
        }

        if ($filters['city'] !== null) {
            $query->where('businesses.city', $filters['city']);
        }

        if ($filters['kind'] !== null) {
            $query->where('businesses.kind', $filters['kind']);
        }

        if ($filters['service'] !== null) {
            $query->where('businesses.services', 'like', '%'.addcslashes(json_encode($filters['service'], JSON_UNESCAPED_UNICODE) ?: '', '%_\\').'%');
        }

        if ($filters['lat'] !== null && $filters['lng'] !== null) {
            // A box around the point (the exact distance is the resource's `distance_km`): LIKE and ranges run on MySQL and MariaDB alike.
            $dLat = $filters['radius_km'] / 111.0;
            $dLng = $filters['radius_km'] / max(1.0, 111.0 * cos(deg2rad($filters['lat'])));
            $query->whereBetween('businesses.lat', [$filters['lat'] - $dLat, $filters['lat'] + $dLat])
                ->whereBetween('businesses.lng', [$filters['lng'] - $dLng, $filters['lng'] + $dLng]);
        }

        // ADR-457: real businesses before samples, each by name.
        $page = $query->orderBy('businesses.is_sample')->orderBy('businesses.name')->orderBy('businesses.id')->cursorPaginate($perPage)->withQueryString();
        $this->prepareCovers($page->items(), $viewer);

        return $page;
    }

    /**
     * Fills Business::$portfolioCover for the businesses without a cover others may see (ADR-457 card fallback: the business's cover,
     * else the newest portfolio build photo, else none), in one query for all of them (ROW_NUMBER, MySQL 8 and MariaDB 10.6+). The
     * portfolio is portfolio()'s: visible builds with a mod whose tag both sides confirmed, real builds before samples.
     *
     * @param  iterable<Business>  $businesses
     */
    public function prepareCovers(iterable $businesses, ?User $viewer): void
    {
        $missing = [];

        foreach ($businesses as $business) {
            $business->loadMissing('cover');

            $cover = $business->cover;

            if (! $cover instanceof Media || ! app(VehiclePresenter::class)->photoVisibleTo($cover, false)) {
                $missing[$business->id] = $business;
            }
        }

        if ($missing === []) {
            return;
        }

        $ranked = VisibleBuilds::withPhoto($this->builds->query($viewer))
            ->join('modifications as m', 'm.vehicle_id', '=', 'vs.vehicle_id')
            ->join('mod_business_tags as t', 't.mod_id', '=', 'm.id')
            ->whereNull('m.deleted_at')
            ->whereIn('m.installed_by_business_id', array_keys($missing))
            ->whereColumn('t.business_id', 'm.installed_by_business_id')
            ->where('t.status', 'accepted')
            ->select('m.installed_by_business_id as business_id', 'vs.vehicle_id')
            ->selectRaw('ROW_NUMBER() OVER (PARTITION BY m.installed_by_business_id ORDER BY '.VisibleBuilds::SAMPLE_RANK.', '.VisibleBuilds::CHANGED_AT.' DESC, vs.vehicle_id DESC) AS position');
        $picked = DB::query()->fromSub($ranked, 'ranked')->where('position', 1)->pluck('vehicle_id', 'business_id');
        $vehicles = $this->builds->vehicles(array_values(array_map(strval(...), $picked->all())));

        foreach ($picked as $businessId => $vehicleId) {
            $vehicle = $vehicles[(string) $vehicleId] ?? null;
            $business = $missing[(string) $businessId] ?? null;

            if ($vehicle instanceof Vehicle && $business instanceof Business) {
                $business->portfolioCover = app(VehiclePresenter::class)->cover($vehicle, false);
            }
        }
    }

    /**
     * DQ-1215, BIZ-01 (API) as WEB-14: the business detail leads with heroCover(). prepareCovers() fills the card fallback (the newest
     * portfolio build's photo); this drops it again when that build has no second photo others may see, because the portfolio card
     * below the hero would then show the same picture. The resource then sends `cover = null`, `cover_source = null`, and the app shows
     * its brand stage. Cards in lists keep the fallback: no portfolio card stands next to them.
     */
    public function prepareHero(Business $business, ?User $viewer): void
    {
        $this->prepareCovers([$business], $viewer);

        if ($business->portfolioCover !== null && $this->heroCover($business, $viewer) === null) {
            $business->portfolioCover = null;
        }
    }

    /**
     * DQ-1215: the cover WEB-14 and its share card lead with. The business's own cover, else the portfolio fallback (prepareCovers)
     * only when its build has another photo others may see: the build's card below then takes that one, so no photo is shown twice.
     * Null otherwise; the page and the card then show the brand layer's photo.
     */
    public function heroCover(Business $business, ?User $viewer): ?Media
    {
        $presenter = app(VehiclePresenter::class);
        $own = $business->cover;

        if ($own instanceof Media && $presenter->photoVisibleTo($own, false)) {
            return $own;
        }

        if ($business->portfolioCover === null) {
            $this->prepareCovers([$business], $viewer);
        }

        $fallback = $business->portfolioCover;

        if (! $fallback instanceof Media || ! $presenter->photoVisibleTo($fallback, false)) {
            return null;
        }

        $other = Media::query()
            ->where('mediable_type', $fallback->getAttribute('mediable_type'))
            ->where('mediable_id', $fallback->getAttribute('mediable_id'))
            ->whereKeyNot($fallback->getKey())
            ->get()
            ->contains(fn (Media $media): bool => $presenter->photoVisibleTo($media, false));

        return $other ? $fallback : null;
    }

    /**
     * @return CursorPaginator<int, Vehicle>
     */
    public function portfolio(?User $viewer, Business $business, int $perPage): CursorPaginator
    {
        // ADR-457: real builds first, badged samples after them.
        return $this->builds->paginate(PartBuilds::realFirst($this->portfolioQuery($viewer, $business)), ['sample' => 'asc', 'sort_at' => 'desc', 'id' => 'desc'], $perPage);
    }

    /**
     * Real builds only (DQ-1140): a sample build in the portfolio is shown, never counted.
     */
    public function portfolioCount(?User $viewer, Business $business): int
    {
        return (int) VisibleBuilds::realOnly($this->portfolioQuery($viewer, $business))->distinct()->count('vs.vehicle_id');
    }

    private function portfolioQuery(?User $viewer, Business $business): QueryBuilder
    {
        return $this->builds->query($viewer)->whereExists(fn (QueryBuilder $mods) => $mods->selectRaw('1')->from('modifications as m')
            ->join('mod_business_tags as t', 't.mod_id', '=', 'm.id')
            ->whereColumn('m.vehicle_id', 'vs.vehicle_id')
            ->whereNull('m.deleted_at')
            ->where('m.installed_by_business_id', $business->id)
            ->where('t.business_id', $business->id)
            ->where('t.status', 'accepted'));
    }

    /**
     * Kilometres between two points (haversine), rounded to one decimal.
     */
    public static function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return round(6371 * 2 * atan2(sqrt($a), sqrt(1 - $a)), 1);
    }
}
