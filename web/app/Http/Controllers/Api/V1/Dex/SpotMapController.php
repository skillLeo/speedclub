<?php

namespace App\Http\Controllers\Api\V1\Dex;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\SpotMapResource;
use App\Services\Dex\SpotMap;

/**
 * Entdecken › Treffen, layer "Spots" (m5.9b contract §6).
 */
class SpotMapController extends Controller
{
    /**
     * Spot map.
     *
     * City aggregates of counted spots for the public heat map: only spots at least 24 hours and at most 90 days old, only cities whose
     * spots are of at least 5 different cars (one car spotted often never shows its town), never a vehicle, a member or a time. Ghost cars and cars whose owner hides their cities do not count.
     * Cached for an hour. Guests too.
     *
     * @unauthenticated
     */
    public function __invoke(SpotMap $map): SpotMapResource
    {
        return new SpotMapResource($map->get());
    }
}
