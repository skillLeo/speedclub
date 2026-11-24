<?php

namespace App\Http\Resources\V1\Stickers;

use App\Enums\QrScanState;
use App\Enums\QrStatus;
use App\Http\Resources\V1\MediaResource;
use App\Models\Media;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrResolver;
use App\Services\Stickers\StickerOrderLink;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One card of STK-01 "Meine Sticker" (m5.4-contract §3 #2): the car, its sticker status (the code's), the scans since Monday and the
 * current design with what the card's three actions may do. Owner only. Needs RELATIONS loaded and `scans_this_week` set.
 *
 * @property Vehicle $resource
 */
class StickerCardResource extends JsonResource
{
    public const RELATIONS = ['make', 'vehicleModel', 'generation', 'cover', 'media', 'owner', 'activeQrCode', 'currentStickerDesign.qrCode'];

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $qr = $vehicle->activeQrCode ?? $vehicle->qrCodes()->latest()->latest('id')->first();
        $qr?->setRelation('vehicle', $vehicle);
        $presenter = app(VehiclePresenter::class);
        $codes = app(QrCodes::class);
        /** @var StickerDesign|null $design */
        $design = $vehicle->currentStickerDesign;
        $design?->setRelation('vehicle', $vehicle);
        $cover = $this->cover($vehicle);
        $orderReason = match (true) {
            $design === null => 'no_design',
            ! $design->isValidated() => 'not_validated',
            $design->stickerOptions()->qr && $design->qrCode?->status !== QrStatus::Active => 'code_replaced',
            ! app(StickerOrderLink::class)->configured($design->stickerOptions()->size) => 'not_configured',
            default => null,
        };

        return [
            'vehicle' => [
                'id' => $vehicle->id,
                'slug' => $vehicle->slug,
                /** "Skyline GT-R R34" */
                'title' => $presenter->title($vehicle),
                /** "Nissan Skyline GT-R R34" */
                'full_title' => $presenter->fullTitle($vehicle),
                /** @var MediaResource|null */
                'cover' => $cover === null ? null : new MediaResource($cover),
                'public_url' => url('/v/'.$vehicle->canonicalSlug()),
            ],
            'sticker' => [
                /**
                 * `active` ("aktiv"), `revoked` ("gesperrt"), or `none` before the car has a code.
                 *
                 * @var 'active'|'revoked'|'none'
                 */
                'status' => $qr === null ? 'none' : $qr->status->value,
                /** @var QrScanState|null */
                'scan_state' => $qr === null ? null : app(QrResolver::class)->stateOf($qr, null),
                /** @var string|null */
                'display_code' => $qr === null ? null : $codes->displayCode($qr->code),
                /** @var string|null */
                'url' => $qr === null ? null : $codes->url($qr),
            ],
            /** Scans since Monday (German time), over all the car's codes. */
            'scans_this_week' => (int) $vehicle->getAttribute('scans_this_week'),
            /**
             * The current version, null before the first save.
             *
             * @var StickerDesignResource|null
             */
            'design' => $design === null ? null : new StickerDesignResource($design),
            'actions' => [
                /** "Gestalten": false for a suspended owner. */
                'design' => $request->user()?->can('designSticker', $vehicle) === true,
                /**
                 * "Bestellen": available, or why not (`no_design`, `not_validated`, `code_replaced`, `not_configured` → "Bestellung bald verfügbar").
                 *
                 * @var array{available: bool, reason: 'no_design'|'not_validated'|'code_replaced'|'not_configured'|null}
                 */
                'order' => ['available' => $orderReason === null, 'reason' => $orderReason],
                /** "Herunterladen": print files exist (a validated design whose code works). */
                'download' => $design !== null && $orderReason !== 'no_design' && $orderReason !== 'not_validated' && $orderReason !== 'code_replaced',
            ],
        ];
    }

    private function cover(Vehicle $vehicle): ?Media
    {
        $cover = $vehicle->cover;

        return $cover !== null && $cover->isUsablePhoto()
            ? $cover
            : $vehicle->media->filter(fn (Media $media): bool => $media->isUsablePhoto())->sortBy([['sort', 'asc'], ['id', 'asc']])->first();
    }
}
