<?php

namespace App\Http\Controllers\Api\V1\Stickers;

use App\Actions\Stickers\RestoreStickerDesign;
use App\Actions\Stickers\SaveStickerDesign;
use App\Actions\Stickers\ValidateStickerDesign;
use App\Enums\ErrorCode;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Garage\GarageListRequest;
use App\Http\Requests\Api\V1\Stickers\PreviewStickerRequest;
use App\Http\Requests\Api\V1\Stickers\RestoreStickerDesignRequest;
use App\Http\Requests\Api\V1\Stickers\SaveStickerDesignRequest;
use App\Http\Requests\Api\V1\Stickers\ValidateStickerDesignRequest;
use App\Http\Resources\V1\Stickers\StickerCardResource;
use App\Http\Resources\V1\Stickers\StickerDesignResource;
use App\Http\Resources\V1\Stickers\StickerPreviewResource;
use App\Http\Resources\V1\Stickers\StickerStatsResource;
use App\Http\Resources\V1\Stickers\StickerTemplatesResource;
use App\Models\QrCode;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerDesigns;
use App\Services\Stickers\StickerQrMatrix;
use App\Services\Stickers\StickerStats;
use App\Support\QaClock;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * STK-01, STK-04, STK-05 and STK-07 (10 §2, m5.4-contract §3). Owner only; a vehicle the member may not see answers 404 as
 * `GET vehicles/{id}` does (SEC-P1-10), another member's visible one 403. A draft has no code and no sticker: 404.
 */
class StickerController extends Controller
{
    /**
     * Sticker templates.
     *
     * The six templates with their sizes in mm (and the printed code size at each), the text options each one shows, the colourways
     * with the materials they allow, and the limits (custom line ≤ 24, code ≥ 25 mm, quiet zone 4 modules, error correction H, bleed).
     */
    public function templates(QrCodes $codes): StickerTemplatesResource
    {
        $sample = new QrCode(['code' => '00000000']);

        return new StickerTemplatesResource(['modules' => count(StickerQrMatrix::of($codes->payload($sample)))]);
    }

    /**
     * My stickers.
     *
     * One card per published vehicle, main vehicle first (as `me/qr-codes`): status of its code, scans since Monday, the current design
     * and what "Gestalten", "Bestellen" and "Herunterladen" may do.
     */
    public function index(GarageListRequest $request, StickerDesigns $designs): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        Gate::authorize('viewAny', Vehicle::class);

        return StickerCardResource::collection($designs->hub($user, $request->pageSize()));
    }

    /**
     * Sticker scan statistics.
     *
     * 30 daily counts, the total, this and last week, the first day with a scan and the sources, over every code the car had. Counts only:
     * nothing about who scanned is stored. 404 `feature_disabled` while `sig.qr_stats` is off.
     */
    public function stats(Request $request, Vehicle $vehicle, FeatureFlags $flags, StickerStats $stats): StickerStatsResource
    {
        if (! $flags->enabled('sig.qr_stats')) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        $this->ownerOnly('manageQr', $vehicle);

        // The 30 days and the weeks end on the QA clock's day outside production (DQ-P5-201), else on today.
        return new StickerStatsResource($stats->forVehicle($this->published($vehicle), QaClock::frozen($request)));
    }

    /**
     * The current sticker design.
     *
     * The highest version, or before the first save an unsaved default (`persisted: false`, `version: 0`) for the editor to start from.
     */
    public function show(Vehicle $vehicle, StickerDesigns $designs): StickerDesignResource
    {
        $this->ownerOnly('manageQr', $vehicle);

        return new StickerDesignResource($designs->current($this->published($vehicle)));
    }

    /**
     * Autosave the sticker design.
     *
     * `base_version` and `base_revision` are the version and revision the app last saw (0 and 0 before the first save); a save from
     * another device in between answers 409 `edit_conflict` with `current_version` and `current_revision`. A draft is updated in place
     * (the revision moves); after a passed Scan-Test the next edit opens a new version.
     * The custom line (≤ 24 characters, one line) goes through the keyword rules: 422 `content_blocked`.
     */
    public function update(SaveStickerDesignRequest $request, Vehicle $vehicle, SaveStickerDesign $save): StickerDesignResource
    {
        $this->ownerOnly('designSticker', $vehicle);

        $design = $save->handle($this->published($vehicle), $request->baseVersion(), $request->baseRevision(), $request->template(), $request->options());

        return new StickerDesignResource($design->setRelation('vehicle', $vehicle));
    }

    /**
     * Preview a sticker design.
     *
     * Renders the posted, unsaved state as SVG (millimetre viewBox, on its surface) for the live preview; stores nothing.
     */
    public function preview(PreviewStickerRequest $request, Vehicle $vehicle, StickerDesigns $designs): StickerPreviewResource
    {
        $this->ownerOnly('designSticker', $vehicle);

        return new StickerPreviewResource($designs->preview($this->published($vehicle), $request->template(), $request->options()));
    }

    /**
     * Run the Scan-Test.
     *
     * The server renders the current version with the car's active code exactly as the print files and decodes it back (error correction
     * H). Pass: the version is validated and frozen with that code. Fail: 422 `sticker_scan_failed`. QR off: validated without a test
     * (`not_applicable`). 409 `edit_conflict` when `version` is not the current one, 409 `sticker_no_active_code` when staff took the code
     * down. Accepts `Idempotency-Key`.
     */
    public function scanTest(ValidateStickerDesignRequest $request, Vehicle $vehicle, ValidateStickerDesign $validate): StickerDesignResource
    {
        $this->ownerOnly('designSticker', $vehicle);

        $design = $validate->handle($this->published($vehicle), $request->version(), $request->clientScanTest());

        return new StickerDesignResource($design->setRelation('vehicle', $vehicle));
    }

    /**
     * Sticker design versions.
     *
     * Every version, newest first: the validated ones and the open draft (STK-07).
     */
    public function versions(GarageListRequest $request, Vehicle $vehicle): AnonymousResourceCollection
    {
        $this->ownerOnly('manageQr', $vehicle);
        $vehicle = $this->published($vehicle);

        $page = $vehicle->stickerDesigns()->with('qrCode')->orderByDesc('version')->orderByDesc('id')
            ->cursorPaginate($request->pageSize())->withQueryString();
        $page->getCollection()->each(fn (StickerDesign $design) => $design->setRelation('vehicle', $vehicle));

        return StickerDesignResource::collection($page);
    }

    /**
     * Restore a version.
     *
     * Its template and options become the current draft, by the autosave rules (a validated current version stays; the restore opens the
     * next one). `base_revision` is the revision the app last saw of the current version: another device's save in between answers 409
     * `edit_conflict` with `current_version` and `current_revision`. Accepts `Idempotency-Key`.
     */
    public function restore(RestoreStickerDesignRequest $request, Vehicle $vehicle, int $version, RestoreStickerDesign $restore): StickerDesignResource
    {
        $this->ownerOnly('designSticker', $vehicle);

        return new StickerDesignResource($restore->handle($this->published($vehicle), $version, $request->baseRevision())->setRelation('vehicle', $vehicle));
    }

    private function ownerOnly(string $ability, Vehicle $vehicle): void
    {
        abort_unless(Gate::allows('view', $vehicle), 404);

        Gate::authorize($ability, $vehicle);
    }

    private function published(Vehicle $vehicle): Vehicle
    {
        return $vehicle->status === VehicleStatus::Draft ? throw new ApiException(ErrorCode::NotFound) : $vehicle;
    }
}
