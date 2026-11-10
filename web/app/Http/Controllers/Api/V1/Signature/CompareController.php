<?php

namespace App\Http\Controllers\Api\V1\Signature;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Signature\CompareRequest;
use App\Http\Resources\V1\CompareResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Signature\CompareBuilds;
use App\Support\Viewer;
use Illuminate\Support\Facades\Gate;

/**
 * VEH-06 [SIG sig.compare] (m2.7-contract §1). Guests may compare; 404 `feature_disabled` while the flag is off (middleware).
 */
class CompareController extends Controller
{
    /**
     * Compare two builds.
     *
     * `a` and `b` are slugs of `/v/{slug}`. Both must be builds the viewer may see on their page, else 404 `vehicle_unavailable` for the
     * whole comparison, without saying which. The same build twice is 422 on `b`. Values in the viewer's language and power unit.
     *
     * @unauthenticated
     */
    public function __invoke(CompareRequest $request, CompareBuilds $compare): CompareResource
    {
        $viewer = Viewer::from($request);
        $a = $this->visible($request->string('a')->toString(), $viewer);
        $b = $this->visible($request->string('b')->toString(), $viewer);
        $locale = app()->getLocale();

        return new CompareResource([
            'a' => $a,
            'b' => $b,
            'specs' => $compare->specs($a, $b, Viewer::powerDisplay($viewer), $locale),
            'mods' => $compare->mods($a, $b, $locale),
        ]);
    }

    private function visible(string $slug, ?User $viewer): Vehicle
    {
        $vehicle = Vehicle::findBySlug($slug);

        if ($vehicle === null || ! Gate::forUser($viewer)->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        return $vehicle->load(CompareBuilds::RELATIONS)->loadCount('modifications');
    }
}
