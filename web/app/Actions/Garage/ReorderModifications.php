<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class ReorderModifications
{
    public function __construct(private readonly VehicleSearchProjector $search) {}

    /**
     * @param  list<string>  $ids  every modification of the vehicle, in the new order
     * @return Collection<int, Modification>
     */
    public function handle(Vehicle $vehicle, array $ids): Collection
    {
        return DB::transaction(function () use ($vehicle, $ids): Collection {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $existing = $vehicle->modifications()->orderBy('sort')->orderBy('id')->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();

            if (array_diff($ids, $existing) !== [] || array_diff($existing, $ids) !== []) {
                $reason = (string) __('garage.order_mismatch');

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['ids' => [$reason]]);
            }

            foreach ($ids as $sort => $id) {
                Modification::query()->whereKey($id)->update(['sort' => $sort]);
            }

            // The first wheels, suspension and exhaust are what search filters on.
            if ($existing !== $ids) {
                $this->search->changed($vehicle);
            }

            return $vehicle->modifications()->orderBy('sort')->orderBy('id')->with(['category.fields', 'brand.mergedInto', 'media'])->get();
        });
    }
}
