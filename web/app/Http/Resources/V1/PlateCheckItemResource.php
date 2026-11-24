<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Services\Garage\VehiclePresenter;
use App\Services\Media\MediaService;
use App\Services\Media\PlateCheck;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One photo of GET me/plate-check (M5.9a, m5.9a-contract §4). Owner only.
 *
 * @mixin Media
 */
class PlateCheckItemResource extends JsonResource
{
    /** The variant the sheet shows and GAR-08 draws on: the widest up to this, else the narrowest. */
    private const IMAGE_WIDTH = 1080;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var Media $media */
        $media = $this->resource;
        $vehicle = PlateCheck::vehicle($media);
        $presenter = app(VehiclePresenter::class);
        [$url, $width] = $this->image($media);
        $mediaWidth = (int) $media->getAttribute('width');
        $height = $mediaWidth > 0 && $width > 0 ? (int) round($width * (int) $media->getAttribute('height') / $mediaWidth) : 0;

        return [
            'media_id' => $media->id,
            'kind' => PlateCheck::kind($media),
            /** @var array{id: string, slug: string, name: string}|null */
            'vehicle' => $vehicle === null ? null : [
                'id' => $vehicle->id,
                'slug' => $vehicle->slug,
                'name' => $presenter->fullTitle($vehicle),
            ],
            /** @var array{url: string, width: int, height: int, thumbhash: string|null, blurhash: string|null} */
            'image' => [
                'url' => $url,
                'width' => $width,
                'height' => $height,
                'thumbhash' => $media->getAttribute('thumbhash'),
                'blurhash' => $media->getAttribute('blurhash'),
            ],
        ];
    }

    /**
     * @return array{0: string, 1: int}
     */
    private function image(Media $media): array
    {
        $urls = app(MediaService::class)->variantUrls($media);
        $fitting = array_filter($urls, fn (int $width): bool => $width <= self::IMAGE_WIDTH, ARRAY_FILTER_USE_KEY);
        $chosen = $fitting !== [] ? $fitting : array_slice($urls, 0, 1, true);
        $width = array_key_last($chosen);

        return $width === null ? ['', 0] : [$chosen[$width], $width];
    }
}
