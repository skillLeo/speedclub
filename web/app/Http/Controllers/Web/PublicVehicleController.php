<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Vehicle;
use App\Services\PublicPages\PublicPageData;
use App\Support\SignedInBrowser;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-01 (FS-10). Everything hidden answers the same page, as the API does (ADR-141), a block with the signed-in browser included. Only the public id at the end of the slug counts;
 * any other text answers with a 301 to the canonical address. That address changes with the name, so no browser may keep the 301: a car
 * renamed and named back would otherwise send it in a circle between its two cached and fresh redirects, sticker scans included.
 */
class PublicVehicleController extends Controller
{
    public function __invoke(Request $request, string $slug, PublicPageData $pages): Response
    {
        $vehicle = Vehicle::findBySlug($slug);

        if ($vehicle === null || ! Gate::forUser(Viewer::from($request))->allows('view', $vehicle) || SignedInBrowser::hasBlockWith($request, $vehicle->owner)) {
            return response()->view('public.state', ['state' => 'vehicle_unavailable'], 404);
        }

        $canonical = $vehicle->canonicalSlug();

        if ($slug !== $canonical) {
            $query = $request->getQueryString();

            return redirect('/v/'.$canonical.($query === null ? '' : '?'.$query), 301, ['Cache-Control' => 'no-cache, private']);
        }

        return response()->view('public.vehicle', $pages->vehicle($vehicle, $request));
    }
}
