<?php

namespace App\Http\Controllers\Api\V1\Qr;

use App\Actions\Qr\ReissueQrCode;
use App\Enums\ErrorCode;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\GarageListRequest;
use App\Http\Requests\Api\V1\Qr\QrPngRequest;
use App\Http\Resources\V1\QrCodeResource;
use App\Http\Resources\V1\QrResolutionResource;
use App\Http\Resources\V1\QrStatsResource;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Services\Qr\QrResolver;
use App\Services\Qr\QrScans;
use App\Services\Qr\QrSticker;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * QR-01 to QR-04 (02_PRODUCT_SPEC §3.4). Owner only, except resolve. Downloads answer to both auth modes through the member group.
 */
class QrCodeController extends Controller
{
    public function __construct(
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
        private readonly QrScans $scans,
    ) {}

    /**
     * My QR codes.
     *
     * One row per vehicle that has been published, main vehicle first, then in the member's order. `status` is the code's own,
     * `scan_state` what a stranger gets right now.
     */
    public function index(GarageListRequest $request): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('viewAny', Vehicle::class);

        return QrCodeResource::collection(
            $user->vehicles()
                ->where('status', '!=', VehicleStatus::Draft)
                ->with(QrCodeResource::RELATIONS)
                ->orderByDesc('is_main')
                ->orderBy('sort')
                ->orderBy('id')
                ->cursorPaginate($request->pageSize())
                ->withQueryString()
        );
    }

    /**
     * The QR code of a vehicle.
     *
     * 404 for a draft, which has no code yet.
     */
    public function show(Vehicle $vehicle): QrCodeResource
    {
        $this->ownerOnly('manageQr', $vehicle);

        return new QrCodeResource($this->published($vehicle)->load(QrCodeResource::RELATIONS));
    }

    /**
     * Download the code as SVG.
     *
     * Black on white with a quiet zone of 4 modules. 404 when the vehicle has no active code.
     */
    public function svg(Vehicle $vehicle): Response
    {
        $this->ownerOnly('manageQr', $vehicle);
        $qr = $this->activeCode($vehicle);

        return $this->download($this->renderer->svg($this->codes->payload($qr)), 'image/svg+xml', $qr, 'svg');
    }

    /**
     * Download the code as PNG.
     *
     * Exactly 1024 or 2048 pixels square (`size`, default 1024), black on white. 404 when the vehicle has no active code.
     */
    public function png(QrPngRequest $request, Vehicle $vehicle): Response
    {
        $this->ownerOnly('manageQr', $vehicle);
        $qr = $this->activeCode($vehicle);

        return $this->download($this->renderer->png($this->codes->payload($qr), $request->size()), 'image/png', $qr, 'png');
    }

    /**
     * Download the A6 sticker sheet as PDF.
     *
     * The code with the logo beside it, @username (left out while `show_owner_on_qr` is off), the short code and a placement hint,
     * with its fonts embedded. Language from `Accept-Language`. 404 when the vehicle has no active code.
     */
    public function pdf(Vehicle $vehicle, QrSticker $sticker): Response
    {
        $this->ownerOnly('manageQr', $vehicle);
        $qr = $this->activeCode($vehicle);

        return $this->download($sticker->pdf($qr), 'application/pdf', $qr, 'pdf');
    }

    /**
     * Replace the QR code.
     *
     * The old code reads "nicht mehr gültig" from now on, so stickers with it stop working. Stays open under a publishing
     * restriction, because a member selling a car must be able to cut the sticker off. 403 `qr_revoked_by_staff` while the newest
     * code is one staff took down: only staff issue the next one then. Accepts `Idempotency-Key`.
     */
    public function reissue(Request $request, Vehicle $vehicle, ReissueQrCode $reissue): QrCodeResource
    {
        $this->ownerOnly('reissueQr', $vehicle);

        /** @var User $user */
        $user = $request->user();
        $reissue->handle($user, $vehicle);

        return new QrCodeResource($vehicle->load(QrCodeResource::RELATIONS));
    }

    /**
     * Scan counts of a vehicle.
     *
     * [SIG] 14 daily counts, the total and the milestones it reached (10, 50, 100, 500, 1000), without anything about who scanned. 404
     * `feature_disabled` while the flag `sig.qr_stats` is off, checked first. Another member's vehicle they may not see answers 404 as
     * `GET vehicles/{id}` does (SEC-P1-10); one they may see, 403.
     */
    public function stats(Vehicle $vehicle, FeatureFlags $flags): QrStatsResource
    {
        if (! $flags->enabled('sig.qr_stats')) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        $this->ownerOnly('manageQr', $vehicle);

        return new QrStatsResource($this->scans->stats($this->published($vehicle)));
    }

    /**
     * Resolve a scanned code.
     *
     * For the app's route c/[code]. Always 200 with `state`: `active` with `slug`, or `revoked`, `private`, `not_found` with the
     * text to show. Upper and lower case both work. A scan by anybody but the owner counts, without IP or user id.
     *
     * @unauthenticated
     */
    public function resolve(Request $request, string $code, QrResolver $resolver): QrResolutionResource
    {
        $viewer = Viewer::from($request);
        $resolution = $resolver->resolve($code, $viewer);

        $this->scans->record($resolution, $request, $viewer);

        return new QrResolutionResource($resolution);
    }

    /**
     * Owner routes answer like `GET vehicles/{id}` for a vehicle the member may not see at all (private, a block, deleted): 404, so they
     * tell nothing about whether it exists (SEC-P1-10). A visible vehicle of somebody else is 403.
     */
    private function ownerOnly(string $ability, Vehicle $vehicle): void
    {
        abort_unless(Gate::allows('view', $vehicle), 404);

        Gate::authorize($ability, $vehicle);
    }

    private function published(Vehicle $vehicle): Vehicle
    {
        return $vehicle->status === VehicleStatus::Draft ? throw new ApiException(ErrorCode::NotFound) : $vehicle;
    }

    private function activeCode(Vehicle $vehicle): QrCode
    {
        $qr = $this->published($vehicle)->qrCodes()->where('status', QrStatus::Active)->first();

        return $qr ?? throw new ApiException(ErrorCode::NotFound);
    }

    private function download(string $body, string $type, QrCode $qr, string $extension): Response
    {
        return new Response($body, 200, [
            'Content-Type' => $type,
            'Content-Disposition' => 'attachment; filename="speedclub-qr-'.$qr->code.'.'.$extension.'"',
            // A revoked sticker must not come back out of a cache.
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
