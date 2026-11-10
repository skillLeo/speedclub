<?php

namespace App\Http\Controllers\Api\V1\Signature;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Signature\ShareCardRequest;
use App\Models\Vehicle;
use App\Services\Signature\ShareCards;
use App\Support\Viewer;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * VEH-07 [SIG sig.share_cards] (m2.7-contract §1). 404 `feature_disabled` while the flag is off (middleware).
 */
class ShareCardController extends Controller
{
    /**
     * Download a share card.
     *
     * PNG, 1080 × 1920 (`format=story`, default) or 1080 × 1080 (`square`): the cover photo, make and model, three specs, @username when
     * the owner shows themselves, the QR code with the logo beside it. `{id}` is the vehicle id. 404 `vehicle_unavailable` for a vehicle
     * the viewer may not see, or one without a usable photo. The stored card of a public build is also at `share_card_url`, which can be
     * cached forever; this answer is `private`.
     *
     * @unauthenticated
     */
    public function __invoke(ShareCardRequest $request, string $id, ShareCards $cards): Response
    {
        $viewer = Viewer::from($request);
        $vehicle = Vehicle::query()->with(ShareCards::RELATIONS)->find($id);

        if (! $vehicle instanceof Vehicle || ! Gate::forUser($viewer)->allows('view', $vehicle)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        $format = $request->cardFormat();
        $png = $cards->png($vehicle, $format) ?? throw new ApiException(ErrorCode::VehicleUnavailable);

        return new Response($png, 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline; filename="speedclub-'.$vehicle->public_id.'-'.$format.'.png"',
            // What a private build or a build that just went private shows must not outlive the answer.
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
