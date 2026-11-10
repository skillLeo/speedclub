<?php

namespace App\Http\Controllers\Api\V1\Signature;

use App\Enums\ErrorCode;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Signature\PlacardRequest;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Services\Signature\Placard;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * QR-02 download "Placard A5 / A4" [SIG sig.placard_pdf] (m2.7-contract §1). Owner only. 404 `feature_disabled` while the flag is off.
 */
class PlacardController extends Controller
{
    /**
     * Download the car-show placard.
     *
     * PDF, A5 (`size=a5`, default) or A4 portrait: the cover photo, title, the Technik tables, the top installed mods per category, the QR
     * code with its short code and the logo, fonts embedded, in the language of `Accept-Language` and the owner's power unit. Owner only:
     * another member's vehicle they may not see is 404, as `GET vehicles/{id}` (SEC-P1-10), one they may see is 403. 404 without an
     * active code.
     */
    public function __invoke(PlacardRequest $request, Vehicle $vehicle, Placard $placard): Response
    {
        abort_unless(Gate::allows('view', $vehicle), 404);
        Gate::authorize('manageQr', $vehicle);

        $qr = $vehicle->status === VehicleStatus::Draft ? null : $vehicle->qrCodes()->where('status', QrStatus::Active)->first();

        if (! $qr instanceof QrCode) {
            throw new ApiException(ErrorCode::NotFound);
        }

        $vehicle->load(['owner', 'make', 'vehicleModel', 'generation', 'specs', 'cover', 'media', 'modifications.category.fields']);
        $size = $request->paperSize();

        return new Response($placard->pdf($vehicle, $qr, $size), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="speedclub-placard-'.$size.'-'.$qr->code.'.pdf"',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
