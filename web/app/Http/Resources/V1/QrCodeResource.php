<?php

namespace App\Http\Resources\V1;

use App\Enums\QrRevocationReason;
use App\Enums\QrScanState;
use App\Enums\QrStatus;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrResolver;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One row of QR-01 and the card of QR-02, for the owner only. The resource is the vehicle, because a row exists for every vehicle
 * that was ever published, with the newest code it has: normally the active one, a revoked one only after staff took it down.
 * A draft has no row and no code.
 *
 * @property Vehicle $resource
 */
class QrCodeResource extends JsonResource
{
    public const RELATIONS = ['make', 'vehicleModel', 'generation', 'cover', 'media', 'owner', 'activeQrCode'];

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $qr = $vehicle->activeQrCode ?? $vehicle->qrCodes()->latest()->latest('id')->first();
        $qr?->setRelation('vehicle', $vehicle);
        $codes = app(QrCodes::class);
        $presenter = app(VehiclePresenter::class);
        $cover = $this->cover($vehicle);

        return [
            'vehicle' => [
                'id' => $vehicle->id,
                'slug' => $vehicle->slug,
                /** "Skyline GT-R R34" */
                'title' => $presenter->title($vehicle),
                /** "Nissan Skyline GT-R R34" */
                'full_title' => $presenter->fullTitle($vehicle),
                'visibility' => $vehicle->visibility,
                /** @var MediaResource|null */
                'cover' => $cover === null ? null : new MediaResource($cover),
                /** The page a scan leads to, for "Öffentliche Seite ansehen". */
                'public_url' => url('/v/'.$vehicle->canonicalSlug()),
            ],
            /** @var QrStatus|null */
            'status' => $qr?->status,
            /**
             * What a stranger gets when scanning it right now: `active`, `private` or `revoked`.
             *
             * @var QrScanState|null
             */
            'scan_state' => $qr === null ? null : app(QrResolver::class)->stateOf($qr, null),
            /** "7H2KQXMB" */
            'code' => $qr?->code,
            /** "7H2K QXMB" */
            'display_code' => $qr === null ? null : $codes->displayCode($qr->code),
            /** "https://speedclub.de/C/7H2KQXMB" */
            'url' => $qr === null ? null : $codes->url($qr),
            /** @var string|null */
            'created_at' => $qr?->created_at?->toIso8601String(),
            /** @var string|null */
            'revoked_at' => $qr?->getAttribute('revoked_at')?->toIso8601String(),
            /** @var QrRevocationReason|null */
            'revoked_reason' => $qr?->getAttribute('revoked_reason'),
            /**
             * Null unless the code is active: a revoked sticker cannot be printed again. With a cookie session these are plain links; a
             * native client sends its bearer token.
             *
             * @var array{svg: string, png_1024: string, png_2048: string, pdf: string}|null
             */
            'downloads' => $qr?->status === QrStatus::Active ? [
                'svg' => route('api.v1.vehicles.qr.svg', ['vehicle' => $vehicle->id]),
                'png_1024' => route('api.v1.vehicles.qr.png', ['vehicle' => $vehicle->id, 'size' => 1024]),
                'png_2048' => route('api.v1.vehicles.qr.png', ['vehicle' => $vehicle->id, 'size' => 2048]),
                'pdf' => route('api.v1.vehicles.qr.pdf', ['vehicle' => $vehicle->id]),
            ] : null,
        ];
    }

    /**
     * The cover the owner's garage shows: a rejected or failed photo does not stand in for the car on a sticker page.
     */
    private function cover(Vehicle $vehicle): ?Media
    {
        $cover = $vehicle->cover;

        return $cover !== null && $cover->isUsablePhoto()
            ? $cover
            : $vehicle->media->filter(fn (Media $media): bool => $media->isUsablePhoto())->sortBy([['sort', 'asc'], ['id', 'asc']])->first();
    }
}
