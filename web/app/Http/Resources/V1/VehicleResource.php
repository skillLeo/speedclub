<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Signature\ShareCards;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * The owner's editable view (GAR-02, GAR-03, GAR-05, GAR-06, GAR-12): the card plus the stored values the forms start from.
 * Another member who may see the vehicle gets the same shape without anything of the owner's.
 *
 * @property Vehicle $resource
 */
class VehicleResource extends VehicleCardResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $vehicle = $this->resource;
        $viewer = Viewer::from($request);
        $specs = $vehicle->specs;

        return [
            ...parent::toArray($request),
            /** @var int|null */
            'make_id' => $vehicle->getAttribute('make_id'),
            /** @var int|null */
            'model_id' => $vehicle->getAttribute('model_id'),
            /** @var int|null */
            'generation_id' => $vehicle->getAttribute('generation_id'),
            /** @var string|null */
            'make_text' => $vehicle->getAttribute('make_text'),
            /** @var string|null */
            'model_text' => $vehicle->getAttribute('model_text'),
            /** @var string|null */
            'description' => $vehicle->getAttribute('description'),
            /** @var string|null */
            'cover_media_id' => $vehicle->getAttribute('cover_media_id'),
            /**
             * Owner only: YYYY-MM, null for anybody else and while sig.hu_au_reminder is off.
             *
             * @var string|null
             */
            'hu_au_due' => $vehicle->isOwnedBy($viewer) && app(FeatureFlags::class)->enabled('sig.hu_au_reminder') ? $vehicle->getAttribute('hu_au_due')?->format('Y-m') : null,
            /** @var array<int, MediaResource> */
            'photos' => MediaResource::collection($this->photosFor($viewer)),
            /**
             * [SIG sig.share_cards] The VEH-07 share cards, PNG, 1080 × 1920 (`story`) and 1080 × 1080 (`square`), immutable: the URL changes
             * with what the card shows. A format is null while it is being drawn (it is queued then), for a private build (its card is
             * never stored) and without a usable photo: GET vehicles/{id}/share-card.png?format= draws it at once. Null while the flag is off.
             *
             * @var array{story: string|null, square: string|null}|null
             */
            'share_card_url' => app(FeatureFlags::class)->enabled('sig.share_cards') ? app(ShareCards::class)->urls($vehicle) : null,
            /**
             * Owner only, empty for anybody else: uploads that failed for good, for the tiles of GAR-07 and nowhere else. Apart from
             * `photos` on purpose: no failed row counts in `photo_count`, the cover, completeness, publishing or the order of
             * PUT media/order. DELETE media/{id} clears one, and media:prune after 30 days.
             *
             * @var array<int, MediaResource>
             */
            'failed_photos' => MediaResource::collection($this->failedPhotosFor($viewer)),
            /**
             * The values as entered, for the form of GAR-06.
             *
             * @var array{engine_code: string|null, engine_text: string|null, displacement_cc: int|null, fuel: string|null, aspiration: string|null, power_value: float|null, power_unit: string|null, power_source: string|null, power_ps: float|null, torque_nm: int|null, torque_source: string|null, drivetrain: string|null, gearbox: string|null}
             */
            'specs' => [
                'engine_code' => $specs?->getAttribute('engine_code'),
                'engine_text' => $specs?->getAttribute('engine_text'),
                'displacement_cc' => $specs?->getAttribute('displacement_cc'),
                'fuel' => $specs?->getAttribute('fuel')?->value,
                'aspiration' => $specs?->getAttribute('aspiration')?->value,
                'power_value' => $specs?->power_value,
                'power_unit' => $specs?->power_unit?->value,
                'power_source' => $specs?->power_source?->value,
                'power_ps' => $specs?->power_ps,
                'torque_nm' => $specs?->getAttribute('torque_nm'),
                'torque_source' => $specs?->getAttribute('torque_source')?->value,
                'drivetrain' => $specs?->getAttribute('drivetrain')?->value,
                'gearbox' => $specs?->getAttribute('gearbox')?->value,
            ],
        ];
    }

    /**
     * @return Collection<int, Media>
     */
    private function failedPhotosFor(?User $viewer): Collection
    {
        if (! $this->resource->isOwnedBy($viewer)) {
            return new Collection;
        }

        return $this->resource->media
            ->filter(fn (Media $media): bool => $media->status === MediaStatus::Failed)
            ->sortBy([['created_at', 'asc'], ['id', 'asc']])
            ->values()
            ->toBase();
    }
}
