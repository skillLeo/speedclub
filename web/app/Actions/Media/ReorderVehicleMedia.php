<?php

namespace App\Actions\Media;

use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Exceptions\ApiException;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\PublicPages\OgImages;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class ReorderVehicleMedia
{
    public function __construct(private readonly OgImages $og) {}

    /**
     * Without a cover the first photo stands for the vehicle, in the OG image too, so the order can change that picture.
     *
     * A failed upload has no place in the order, as with the photo limit in UploadVehicleMedia: it shows nowhere and never counts.
     *
     * @param  list<string>  $ids  every photo of the vehicle, in the new order
     * @return Collection<int, Media>
     */
    public function handle(Vehicle $vehicle, array $ids): Collection
    {
        return DB::transaction(function () use ($vehicle, $ids): Collection {
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $existing = $vehicle->media()->where('status', '!=', MediaStatus::Failed)->pluck('id')->map(fn (mixed $id): string => (string) $id)->all();

            if (array_diff($ids, $existing) !== [] || array_diff($existing, $ids) !== []) {
                $reason = (string) __('media.order_mismatch');

                throw new ApiException(ErrorCode::ValidationFailed, $reason, errors: ['ids' => [$reason]]);
            }

            foreach ($ids as $sort => $id) {
                Media::query()->whereKey($id)->update(['sort' => $sort]);
            }

            $this->og->queue($vehicle);

            return $vehicle->media()->where('status', '!=', MediaStatus::Failed)->orderBy('sort')->get();
        });
    }
}
