<?php

namespace App\Http\Controllers\Api\V1\Stickers;

use App\Actions\Stickers\RequestStickerOrderLink;
use App\Enums\ErrorCode;
use App\Enums\VehicleStatus;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Stickers\StickerOrderLinkResource;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Stickers\StickerFiles;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Files and the order link of one design version (m5.4-contract §3 #10–#13, §6, §7). Owner only, by the design's vehicle. Print files
 * carry the sticker code `/c/{code}` (that is what a sticker is for); the share picture carries the car's page (ADR-514).
 */
class StickerFileController extends Controller
{
    public function __construct(private readonly StickerFiles $files) {}

    /**
     * Preview of a version as SVG.
     *
     * On its surface, logo linked: for thumbnails in the hub and the history. Any version.
     */
    public function preview(StickerDesign $design): Response
    {
        $vehicle = $this->vehicleOf($design, 'manageQr');

        return $this->file($this->files->previewSvg($design, $vehicle), 'image/svg+xml', $design, 'preview.svg', inline: true);
    }

    /**
     * Download the print SVG.
     *
     * Millimetre units, one group per ink, text as outlines, the logo embedded, the die line in `CutContour`. Validated versions only:
     * 409 `sticker_not_validated`; 409 `sticker_code_replaced` once their code is no longer active.
     */
    public function printSvg(StickerDesign $design): Response
    {
        $vehicle = $this->printable($design);

        return $this->file($this->files->printSvg($design, $vehicle), 'image/svg+xml', $design, 'svg');
    }

    /**
     * Download the print PDF.
     *
     * Exact size (TrimBox) with 3 mm bleed (BleedBox), crop marks, the die line, the design id and production notes in the slug, fonts
     * embedded; page 2 is a proof on the surface, not for printing. Same conditions as the SVG.
     */
    public function printPdf(StickerDesign $design): Response
    {
        $vehicle = $this->printable($design);

        return $this->file($this->files->printPdf($design, $vehicle), 'application/pdf', $design, 'pdf');
    }

    /**
     * Download the print PNG.
     *
     * 300 dpi, transparent, inks only, mirrored when the design is. Same conditions as the SVG.
     */
    public function printPng(StickerDesign $design): Response
    {
        $vehicle = $this->printable($design);

        return $this->file($this->files->printPng($design, $vehicle), 'image/png', $design, 'png');
    }

    /**
     * Picture to share.
     *
     * 1600 px on the long edge, the sticker on its surface. Its code leads to the car's public page, never to the sticker code (ADR-514).
     */
    public function share(StickerDesign $design): Response
    {
        $vehicle = $this->vehicleOf($design, 'manageQr');

        return $this->file($this->files->sharePng($design, $vehicle), 'image/png', $design, 'share.png', inline: true);
    }

    /**
     * Order link.
     *
     * The Shopify cart link with the design attached (`attributes[sticker_design]`, `attributes[vehicle]`), or `available: false` with
     * "Bestellung bald verfügbar" while no store is configured. Needs a validated version whose code still works (409 as the print
     * files). Accepts `Idempotency-Key`.
     */
    public function orderLink(StickerDesign $design, RequestStickerOrderLink $order): StickerOrderLinkResource
    {
        $vehicle = $this->vehicleOf($design, 'designSticker');

        return new StickerOrderLinkResource(['url' => $order->handle($design, $vehicle)]);
    }

    private function printable(StickerDesign $design): Vehicle
    {
        $vehicle = $this->vehicleOf($design, 'manageQr');
        RequestStickerOrderLink::assertPrintable($design);

        return $vehicle;
    }

    /**
     * As the vehicle routes: 404 for a car the member may not see (SEC-P1-10), 403 for another member's visible one, 404 for a draft.
     */
    private function vehicleOf(StickerDesign $design, string $ability): Vehicle
    {
        $vehicle = $design->vehicle;

        abort_unless($vehicle !== null && Gate::allows('view', $vehicle), 404);
        Gate::authorize($ability, $vehicle);

        if ($vehicle->status === VehicleStatus::Draft) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return $vehicle;
    }

    private function file(string $body, string $type, StickerDesign $design, string $suffix, bool $inline = false): Response
    {
        $name = 'speedclub-sticker-'.$design->reference.'-v'.$design->version.'.'.$suffix;

        return new Response($body, 200, [
            'Content-Type' => $type,
            'Content-Disposition' => ($inline ? 'inline' : 'attachment').'; filename="'.$name.'"',
            // A replaced code must not come back out of a cache.
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
