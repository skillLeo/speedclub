<?php

namespace App\Http\Resources\V1;

use App\Models\Media;
use App\Services\Media\MediaService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The private original never appears here. Variants are empty until status is ready.
 *
 * @mixin Media
 */
class MediaResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var int|null $width */
        $width = $this->width;
        /** @var int|null $height */
        $height = $this->height;

        $variants = [];

        foreach (app(MediaService::class)->variantUrls($this->resource) as $variantWidth => $url) {
            $variants[] = [
                'width' => $variantWidth,
                'height' => $width > 0 ? (int) round($variantWidth * (int) $height / (int) $width) : 0,
                'url' => $url,
            ];
        }

        return [
            'id' => $this->id,
            'status' => $this->status,
            'category' => $this->category,
            'width' => $width,
            'height' => $height,
            'blurhash' => $this->blurhash,
            /**
             * ThumbHash of an editorial/sample photo (09 §4.6, from design/scripts/process-photos.mjs); null for member uploads, which
             * keep the blurhash. expo-image: `placeholder={{ thumbhash }}` when set.
             */
            'thumbhash' => $this->thumbhash,
            'focal_x' => $this->focal_x,
            'focal_y' => $this->focal_y,
            'alt' => $this->alt,
            'sort' => (int) $this->sort,
            /** @var list<array{width: int, height: int, url: string}> */
            'variants' => $variants,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
