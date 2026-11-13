<?php

namespace App\Http\Controllers\Api\V1\Events;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Events\GeocodeRequest;
use App\Http\Resources\V1\GeocodeResultResource;
use App\Models\Event;
use App\Services\Events\Geocoder;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class GeocodeController extends Controller
{
    /**
     * Search a place.
     *
     * EVT-03 "Ort": up to 5 places for an address or venue, through the server (OpenStreetMap Nominatim, 09 §8.7): search on submit
     * only, 60 an hour per member, cached 30 days. 503 geocode_unavailable when the service does not answer; the pin can still be set
     * by hand. Show "© OpenStreetMap-Mitwirkende" with the results.
     */
    public function __invoke(GeocodeRequest $request, Geocoder $geocoder): AnonymousResourceCollection
    {
        // Security review L5: only members who may organise spend the shared upstream slot.
        Gate::authorize('create', Event::class);

        $locale = app()->getLocale() === 'en' ? 'en' : 'de';

        return GeocodeResultResource::collection($geocoder->search((string) $request->validated('q'), $locale));
    }
}
