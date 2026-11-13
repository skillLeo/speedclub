<?php

namespace App\Services\Businesses;

use App\Enums\BusinessStatus;
use App\Enums\UserStatus;
use App\Models\Business;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Showcase\SampleContent;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

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
        $query = $this->visible($viewer)->with(['logo', 'owner']);

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

        return $query->orderBy('businesses.name')->orderBy('businesses.id')->cursorPaginate($perPage)->withQueryString();
    }

    /**
     * @return CursorPaginator<int, Vehicle>
     */
    public function portfolio(?User $viewer, Business $business, int $perPage): CursorPaginator
    {
        $hits = $this->portfolioQuery($viewer, $business)->select('vs.vehicle_id as id', VisibleBuilds::CHANGED_AT.' as sort_at');

        return $this->builds->paginate($hits, ['sort_at' => 'desc', 'id' => 'desc'], $perPage);
    }

    public function portfolioCount(?User $viewer, Business $business): int
    {
        return (int) $this->portfolioQuery($viewer, $business)->distinct()->count('vs.vehicle_id');
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
