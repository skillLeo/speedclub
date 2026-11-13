<?php

namespace App\Http\Resources\V1;

use App\Enums\MaintenanceType;
use App\Http\Resources\Concerns\AnswersDelivery;
use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\User;
use App\Services\Maintenance\MaintenanceMedia;
use App\Support\Units;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An entry of MNT-01 "Verlauf" (09 §8.8). Owner-only, the cost included (private to the owner, never in any other answer).
 *
 * @property MaintenanceLog $resource
 */
class MaintenanceLogResource extends JsonResource
{
    use AnswersDelivery;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $log = $this->resource;
        $viewer = Viewer::from($request);
        $locale = app()->getLocale();
        $photos = $log->relationLoaded('media') ? $log->getRelation('media') : $log->media()->orderBy('sort')->get();

        return [
            'id' => $log->id,
            'vehicle_id' => $log->vehicle_id,
            'item_id' => $log->item_id,
            /** @var MaintenanceType */
            'type' => $log->type,
            'title' => $log->title,
            'done_at' => $log->done_at->toDateString(),
            'mileage_km' => $log->mileage_km,
            /** Free text ("Werkstatt am Ring"). */
            'workshop' => $log->workshop,
            /** M4.14: the linked business profile; null until business profiles exist. */
            'business_id' => $log->business_id,
            /**
             * Private: only ever in the owner's answers. label: "189,00 €" in the request's language.
             *
             * @var array{cents: int, currency: string, label: string}|null
             */
            'cost' => $log->cost_cents === null ? null : [
                'cents' => $log->cost_cents,
                'currency' => $log->currency,
                'label' => Units::formatMoney($log->cost_cents, $locale),
            ],
            'notes' => $log->notes,
            /**
             * Receipts and booklet photos from the private disk: signed URLs for the reader, valid about 10 minutes.
             *
             * @var list<array{id: string, status: string, width: int|null, height: int|null, blurhash: string|null, variants: list<array{width: int, height: int, url: string}>}>
             */
            'photos' => $photos->sortBy('sort')->values()->map(fn (Media $photo): array => [
                'id' => $photo->id,
                'status' => $photo->status->value,
                'width' => $photo->getAttribute('width'),
                'height' => $photo->getAttribute('height'),
                'blurhash' => $photo->getAttribute('blurhash'),
                'variants' => $viewer instanceof User && $photo->isUsablePhoto() ? app(MaintenanceMedia::class)->variants($photo, $viewer) : [],
            ])->all(),
            'version' => $log->version,
            'created_at' => $log->created_at?->toIso8601String(),
            'updated_at' => $log->updated_at?->toIso8601String(),
        ];
    }
}
