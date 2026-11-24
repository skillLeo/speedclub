<?php

namespace App\Http\Resources\V1;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\Rarity;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use App\Services\Dex\RarityRules;
use App\Services\Dex\SpotCard;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * STREET DEX SpotCard (m5.9b contract §2, §10): the card of DEX-01/03/04/05. Never a coordinate, never a city of a single spot, never a
 * spot count: `cities_count_label` names how many cities the car was spotted in by day, and is null while the owner hides the cities.
 * `spotted` is false for the DEX-04 preview of a car the viewer has not spotted yet; spot_id and spotted_at are null then.
 *
 * @property SpotCard $resource
 */
class SpotCardResource extends JsonResource
{
    /** The width of the cover variant the card loads. */
    private const COVER_WIDTH = 1080;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $card = $this->resource;
        $spot = $card->spot;

        return [
            /** Null for the preview of a car the viewer has not spotted. */
            'spot_id' => $spot?->id,
            'spotted_at' => $spot?->created_at?->toIso8601String(),
            /** False for the "noch nicht gespottet" preview of DEX-04. */
            'spotted' => $spot !== null,
            /**
             * @var array{id: string, slug: string, name: string, make: string|null, make_slug: string|null, model: string|null, generation: string|null, generation_slug: string|null, dex_number: int|null, rarity: Rarity, ghost: bool, cover: array{url: string, width: int, height: int, thumbhash: string|null, blurhash: string|null}|null, top_mods: list<array{name: string, brand: string|null}>, owner: array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|null}
             */
            'vehicle' => $this->vehicle($card->vehicle),
            /** One of the car's first three spotters: the permanent foil. */
            'first_spotter' => $card->firstSpotter,
            /** "In 9 Städten gespottet": cities of day spots, null when there are none or the owner hides the cities. */
            'cities_count_label' => $this->citiesLabel($card->vehicle),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function vehicle(Vehicle $vehicle): array
    {
        $presenter = app(VehiclePresenter::class);

        return [
            'id' => $vehicle->id,
            'slug' => $vehicle->slug,
            'name' => $presenter->fullTitle($vehicle),
            'make' => $presenter->makeName($vehicle),
            'make_slug' => $vehicle->make?->slug,
            'model' => $presenter->modelName($vehicle),
            'generation' => $vehicle->generation?->name,
            'generation_slug' => $vehicle->generation?->slug,
            'dex_number' => $vehicle->dex_number,
            'rarity' => RarityRules::shown($vehicle),
            'ghost' => $vehicle->ghost_mode === true,
            'cover' => $this->cover($presenter->cover($vehicle, false)),
            'top_mods' => array_values($vehicle->modifications->take(3)->map(fn (Modification $mod): array => [
                'name' => (string) $mod->getAttribute('title'),
                'brand' => $mod->brand?->getAttribute('name') ?? $mod->getAttribute('brand_text'),
            ])->all()),
            'owner' => $this->owner($vehicle->owner),
        ];
    }

    /**
     * @return array{url: string, width: int, height: int, thumbhash: string|null, blurhash: string|null}|null
     */
    private function cover(?Media $media): ?array
    {
        if ($media === null) {
            return null;
        }

        $urls = app(MediaService::class)->variantUrls($media);

        if ($urls === []) {
            return null;
        }

        $width = array_key_last(array_filter($urls, fn (int $w): bool => $w <= self::COVER_WIDTH, ARRAY_FILTER_USE_KEY)) ?? array_key_first($urls);
        $original = (int) $media->getAttribute('width');

        return [
            'url' => $urls[$width],
            'width' => $width,
            'height' => $original > 0 ? (int) round($width * (int) $media->getAttribute('height') / $original) : 0,
            'thumbhash' => $media->getAttribute('thumbhash'),
            'blurhash' => $media->getAttribute('blurhash'),
        ];
    }

    /**
     * The owner as the sticker page names them; null when they asked not to be named there (show_owner_on_qr off).
     *
     * @return array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|null
     */
    private function owner(?User $owner): ?array
    {
        if ($owner === null || $owner->getAttribute('show_owner_on_qr') === false || $owner->username === null) {
            return null;
        }

        return [
            'username' => $owner->username,
            'display_name' => $owner->getAttribute('display_name'),
            'avatar' => self::avatar($owner->avatar),
        ];
    }

    /**
     * The smallest variant of a finished, unrejected avatar.
     *
     * @return array{url: string, thumbhash: string|null}|null
     */
    public static function avatar(?Media $avatar): ?array
    {
        if ($avatar === null || $avatar->status !== MediaStatus::Ready || $avatar->moderation_status === ModerationStatus::Rejected) {
            return null;
        }

        $urls = app(MediaService::class)->variantUrls($avatar);

        return $urls === [] ? null : ['url' => $urls[array_key_first($urls)], 'thumbhash' => $avatar->getAttribute('thumbhash')];
    }

    private function citiesLabel(Vehicle $vehicle): ?string
    {
        $stats = $vehicle->getRelationValue('spotStats');
        $count = $stats instanceof VehicleSpotStat ? $stats->cities_count : 0;

        return $count === 0 || $vehicle->hide_spot_cities ? null : trans_choice('dex.cities_count', $count, ['count' => $count]);
    }
}
