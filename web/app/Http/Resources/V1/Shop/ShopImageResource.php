<?php

namespace App\Http\Resources\V1\Shop;

use App\Services\Shop\Views\ShopImageView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A shop photo (m5.5-contract §3.4): public WebP variants 320/640/1080/1600 only, never the private original. Product photos are 4:5;
 * the hero keeps its own ratio (`aspect`). expo-image: `placeholder={{ thumbhash }}` when set, else the blurhash.
 *
 * @property ShopImageView $resource
 */
class ShopImageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $image = $this->resource;

        return [
            'id' => $image->id,
            'width' => $image->width,
            'height' => $image->height,
            /** "4:5" for product photos; the real ratio ("16:9", "3:2" …) for the hero. */
            'aspect' => $image->aspect,
            'blurhash' => $image->blurhash,
            /** @var string|null */
            'thumbhash' => $image->thumbhash,
            'focal_x' => $image->focalX,
            'focal_y' => $image->focalY,
            /** @var string|null */
            'alt' => $image->alt,
            /** @var list<array{width: int, height: int, url: string}> */
            'variants' => $image->variants,
        ];
    }
}
