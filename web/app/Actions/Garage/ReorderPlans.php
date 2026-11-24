<?php

namespace App\Actions\Garage;

use App\Enums\ErrorCode;
use App\Enums\ModStatus;
use App\Exceptions\ApiException;
use App\Models\Modification;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

/**
 * M5.3 "Pläne": the owner's order of the planned mods (m5.3-contract §4.3), apart from the order of the build sheet (`sort`, which
 * search reads). No Verlauf entry and no search touch: the order of plans is not build news.
 */
class ReorderPlans
{
    /**
     * @param  list<string>  $ids  every planned modification of the vehicle, in the new order
     * @return Collection<int, Modification>
     */
    public function handle(Vehicle $vehicle, array $ids): Collection
    {
        return DB::transaction(function () use ($vehicle, $ids): Collection {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $existing = $this->plans($vehicle)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();

            if (array_diff($ids, $existing) !== [] || array_diff($existing, $ids) !== []) {
                $reason = (string) __('garage.order_mismatch');

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['ids' => [$reason]]);
            }

            foreach ($ids as $sort => $id) {
                Modification::query()->whereKey($id)->update(['plan_sort' => $sort]);
            }

            return $this->plans($vehicle)->with(['category.fields', 'brand.mergedInto', 'media', 'vehicle'])->get();
        });
    }

    /**
     * @return HasMany<Modification, Vehicle>
     */
    private function plans(Vehicle $vehicle): HasMany
    {
        return $vehicle->modifications()->where('status', ModStatus::Planned->value)->orderByRaw('plan_sort is null')->orderBy('plan_sort')->orderBy('sort')->orderBy('id');
    }
}
