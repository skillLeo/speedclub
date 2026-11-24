<?php

namespace App\Services\Media;

use Illuminate\Contracts\Image\Transformation;

/**
 * M5.9a: a step of the image pipeline (ImageProcessor), run by Pixelator on GD right after the EXIF orientation and before any encoding,
 * so the regions are pixelated in the decoded pixels and no file is ever written from the unblurred picture.
 *
 * @phpstan-import-type Region from Pixelator
 */
final readonly class PixelateRegions implements Transformation
{
    /**
     * @param  list<Region>  $regions  normalised 0–1 from the top left of the oriented photo
     */
    public function __construct(public array $regions) {}
}
