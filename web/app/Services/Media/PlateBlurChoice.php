<?php

namespace App\Services\Media;

use App\Enums\PlateBlurState;

/**
 * M5.9a (m5.9a-contract §1, §2): the member's plate decision for one upload, read from the request by ValidatesPlateBlur and handed to
 * MediaService::reserve(), which stores the state and the regions the pipeline pixelates before anything is written.
 *
 * @phpstan-type Region array{x: float, y: float, w: float, h: float, angle?: float}
 * @phpstan-type RegionInput array{x: float|int|string, y: float|int|string, w: float|int|string, h: float|int|string, angle?: float|int|string|null}
 */
final readonly class PlateBlurChoice
{
    /**
     * @param  list<Region>  $regions  normalised 0–1 from the top left of the photo as displayed (after EXIF orientation); empty unless blurred
     */
    private function __construct(public PlateBlurState $state, public array $regions) {}

    /** No `plate_blur` field: an older build or another client. Nothing is pixelated; the plate check lists the photo. */
    public static function unchecked(): self
    {
        return new self(PlateBlurState::Unchecked, []);
    }

    /** `plate_blur=0`: the member switched it off. Any regions sent along are ignored. */
    public static function declined(): self
    {
        return new self(PlateBlurState::Declined, []);
    }

    /**
     * `plate_blur=1` with at least one validated region.
     *
     * @param  array<int|string, RegionInput>  $regions
     */
    public static function blurred(array $regions): self
    {
        return new self(PlateBlurState::Blurred, self::normalise($regions));
    }

    /**
     * Rounded to 4 decimals and clipped to the photo, as stored in media.blur_regions. `angle` (degrees clockwise, −45…45, 1 decimal) is
     * kept only when it turns the rectangle, so an unturned region is stored exactly as before.
     *
     * @param  array<int|string, RegionInput>  $regions
     * @return list<Region>
     */
    public static function normalise(array $regions): array
    {
        $clamp = fn (float|int|string $value): float => round(max(0.0, min(1.0, (float) $value)), 4);

        return array_values(array_map(function (array $region) use ($clamp): array {
            $normalised = [
                'x' => $clamp($region['x']),
                'y' => $clamp($region['y']),
                'w' => $clamp($region['w']),
                'h' => $clamp($region['h']),
            ];
            $angle = isset($region['angle']) && is_numeric($region['angle'])
                ? round(max(-Pixelator::MAX_ANGLE, min(Pixelator::MAX_ANGLE, (float) $region['angle'])), 1)
                : 0.0;

            if ($angle !== 0.0) {
                $normalised['angle'] = $angle;
            }

            return $normalised;
        }, $regions));
    }
}
