<?php

namespace App\Actions\Media;

use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Collection;

/**
 * The hook for paths that do not exist yet: deleting a vehicle (M1.6, 02_PRODUCT_SPEC §3.2) and deactivating a member
 * (M1.5, §3.1) must call this, because their photos stop being public right away as well.
 *
 * forMember() can touch hundreds of photos, so on shared hosting it belongs in a queued job.
 */
class DeleteAllMedia
{
    public function __construct(private readonly DeleteMedia $delete) {}

    /**
     * Gallery and mod photos of a vehicle.
     */
    public function forVehicle(Vehicle $vehicle): int
    {
        return $this->deleteEach($this->photosOf($vehicle));
    }

    /**
     * @return Collection<int, Media>
     */
    public function photosOf(Vehicle $vehicle): Collection
    {
        return Media::query()
            ->where(fn ($query) => $query
                ->where(fn ($gallery) => $gallery->where('mediable_type', $vehicle->getMorphClass())->where('mediable_id', $vehicle->getKey()))
                ->orWhere(fn ($mods) => $mods
                    ->where('mediable_type', (new Modification)->getMorphClass())
                    ->whereIn('mediable_id', Modification::withTrashed()->where('vehicle_id', $vehicle->getKey())->select('id'))))
            ->get();
    }

    /**
     * Everything a member uploaded, whatever it is attached to.
     */
    public function forMember(User $member): int
    {
        return $this->deleteEach(Media::query()->where('owner_id', $member->getKey())->get());
    }

    /**
     * @param  iterable<Media>  $photos
     */
    private function deleteEach(iterable $photos): int
    {
        $count = 0;

        foreach ($photos as $photo) {
            $this->delete->handle($photo);
            $count++;
        }

        return $count;
    }
}
