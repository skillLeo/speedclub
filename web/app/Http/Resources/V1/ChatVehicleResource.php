<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A vehicle in messaging (M2.4): the context card of a conversation and a vehicle message. Only built for a vehicle the reader may view.
 *
 * @property Vehicle $resource
 */
class ChatVehicleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $presenter = app(VehiclePresenter::class);
        $viewer = Viewer::from($request) ?? $request->user();
        $owned = $vehicle->isOwnedBy($viewer instanceof User ? $viewer : null);
        $cover = $presenter->cover($vehicle, $owned);
        $owner = $vehicle->owner;

        return [
            'id' => $vehicle->id,
            'slug' => $vehicle->slug,
            /** "Nissan Skyline GT-R R34" */
            'full_title' => $presenter->fullTitle($vehicle),
            'cover' => $cover instanceof Media ? new MediaResource($cover) : null,
            /**
             * "Fahrzeug von @lukas.sc". Null when the owner asked not to be named on the vehicle page (ADR-148 a), unless it is the reader.
             *
             * @var string|null
             */
            'owner_username' => $owner instanceof User && ($owned || $owner->getAttribute('show_owner_on_qr') !== false) ? $owner->username : null,
        ];
    }
}
