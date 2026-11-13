<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A vehicle a row points at (HOME-02): enough for a thumbnail and the link to VEH-01.
 *
 * @property Vehicle $resource
 */
class VehicleRefResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $presenter = app(VehiclePresenter::class);
        $cover = $presenter->cover($vehicle, $vehicle->isOwnedBy(Viewer::from($request)));

        return [
            'id' => $vehicle->id,
            'slug' => $vehicle->slug,
            /** "Nissan Skyline GT-R R34" */
            'full_title' => $presenter->fullTitle($vehicle),
            'cover' => $cover instanceof Media ? new MediaResource($cover) : null,
            /** Sample content (09 §8.19): the "Beispiel" badge. */
            'is_sample' => $vehicle->getAttribute('is_sample') === true,
        ];
    }
}
