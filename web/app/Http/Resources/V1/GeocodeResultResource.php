<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A place found by GET geocode (Nominatim through the server): the line to show and the parts EVT-03 fills in; lat/lng place the pin,
 * which the organiser can still drag. Data © OpenStreetMap contributors (ODbL); the app shows the attribution.
 *
 * @property array{label: string, venue_name: string|null, street: string|null, postcode: string|null, city: string|null, country: string|null, lat: float, lng: float} $resource
 */
class GeocodeResultResource extends JsonResource
{
    /**
     * @return array{label: string, venue_name: string|null, street: string|null, postcode: string|null, city: string|null, country: string|null, lat: float, lng: float}
     */
    public function toArray(Request $request): array
    {
        return $this->resource;
    }
}
