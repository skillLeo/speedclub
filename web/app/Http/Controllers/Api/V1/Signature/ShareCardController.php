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
use Illuminate\Validation\ValidationException;

/**
 * VEH-07 [SIG sig.share_cards] (m2.7-contract §1). 404 `feature_disabled` while the flag is off (middleware).
 */
class ShareCardController extends Controller
{
    /**
     * Download a share card.
     *
     * PNG, 1080 × 1920 (`format=story`, default) or 1080 × 1080 (`square`): the cover photo, make and model, three specs, @username when
     * the owner shows themselves, the Build Score and the Dex number when the build has them, the QR code of the build's page (ADR-514)
     * with the logo beside it. The square card keeps the photo in its upper part and holds everything else in a band below it (CF-6).
     * CF-6 customisation: `photo`, `show` and `theme`; R5-2e (VEH-07 2.0): `template` (`band`, `poster`, `frame`), the crop (`zoom`, `x`,
     * `y`, in the template's photo box aspect), the `mods` element and an own `text` line (see the parameters). Without parameters (or with
     * the defaults) the card is the stored one at `share_card_url`; any other choice is drawn for this viewer, cached privately and never
     * given a URL. 422 on `text` for characters the card fonts do not draw, more than 60 characters or a blocked term (`content_blocked`).
     * `{id}` is the vehicle id. 404 `vehicle_unavailable` for a vehicle the viewer may not see, or one without a usable photo; 422 on
     * `photo` for an id that is not one of the build's public photos. The stored card of a public build is also at `share_card_url`,
     * which can be cached forever; this answer is `private`.
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
        $options = $request->cardOptions();

        if ($options->photo !== null && $cards->photo($vehicle, $options) === null) {
            throw ValidationException::withMessages(['photo' => __('signature.share_card.photo')]);
        }

        $png = $cards->png($vehicle, $format, $options) ?? throw new ApiException(ErrorCode::VehicleUnavailable);

        return new Response($png, 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline; filename="speedclub-'.$vehicle->public_id.'-'.$format.'.png"',
            // What a private build or a build that just went private shows must not outlive the answer.
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
