<?php

namespace App\Services\Brand;

use App\Models\BrandAsset;
use GdImage;
use Illuminate\Image\ImageException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * The hero contrast rule of ADM-28 (ADR-129, ADR-151, ADR-152, FS-1): a photo is placed as FS-1 places it (cover, centred on the focal
 * point) in each reference frame of config('speedclub.brand.hero_check.frames'), and two areas are measured:
 *
 * - the logo slot (width min(72 %, 320), top at 28 %, the wordmark's aspect): white ink over the photo darkened by the logo shadow's
 *   guaranteed minimum (42 % black, ADR-151) or the scrim where it is stronger;
 * - the bottom block (from the block top to the bottom): `onPhoto.secondary` (white at 80 %) over the photo under the scrim, which fades
 *   in from max(45 %, block top − 48) and stands at `overlay.photoScrimEnd` (72 % black) from the block top (ADR-152 a).
 *
 * Each pixel's contrast is computed in sRGB as a browser composes it; the 2nd percentile (98 % of the area) must reach 4.5:1, so a
 * single specular highlight does not refuse a photo but a bright sky behind the logo does. Measured at half resolution.
 */
final class HeroContrast
{
    private const SCALE = 0.5;

    private const PERCENTILE = 0.02;

    public function forAsset(BrandAsset $asset, float $focalX, float $focalY): HeroContrastResult
    {
        $focalX = round(max(0.0, min(1.0, $focalX)), 3);
        $focalY = round(max(0.0, min(1.0, $focalY)), 3);

        /** @var array{0: float, 1: float, 2: string} $values */
        $values = Cache::remember("brand:hero-contrast:v1:{$asset->id}:$focalX:$focalY", 86400, function () use ($asset, $focalX, $focalY): array {
            $result = $this->measure($this->bytes($asset), $focalX, $focalY);

            return [$result->logoRatio, $result->textRatio, $result->frame];
        });

        return new HeroContrastResult($values[0], $values[1], $values[2], $this->minimum());
    }

    /**
     * @throws ImageException when the bytes do not decode
     */
    public function measure(string $bytes, float $focalX, float $focalY): HeroContrastResult
    {
        $source = @imagecreatefromstring($bytes);

        if (! $source instanceof GdImage) {
            throw new ImageException('The hero photo could not be decoded.');
        }

        $worst = null;

        /** @var array<string, array{0: int, 1: int}> $frames */
        $frames = config('speedclub.brand.hero_check.frames');

        foreach ($frames as $name => [$width, $height]) {
            [$logo, $text] = $this->frame($source, (int) $width, (int) $height, $focalX, $focalY);
            $candidate = new HeroContrastResult($logo, $text, (string) $name, $this->minimum());

            if ($worst === null || min($logo, $text) < min($worst->logoRatio, $worst->textRatio)) {
                $worst = $candidate;
            }
        }

        return $worst ?? new HeroContrastResult(0.0, 0.0, 'none', $this->minimum());
    }

    /**
     * @return array{0: float, 1: float} logo and text ratio in this frame
     */
    private function frame(GdImage $source, int $width, int $height, float $focalX, float $focalY): array
    {
        $w = max(1, (int) round($width * self::SCALE));
        $h = max(1, (int) round($height * self::SCALE));
        $canvas = $this->cover($source, $w, $h, $focalX, $focalY);
        $check = config()->array('speedclub.brand.hero_check');

        $scrimEnd = (float) $check['scrim_end_alpha'];
        $shadowMin = (float) $check['logo_shadow_alpha'];
        $textAlpha = (float) $check['text_alpha'];

        $blockTop = $height - (int) $check['block_height'];
        $fadeStart = max(0, min($height * 0.45, $blockTop - (int) $check['scrim_fade']));
        $scrim = function (float $y) use ($blockTop, $fadeStart, $scrimEnd): float {
            if ($y >= $blockTop) {
                return $scrimEnd;
            }

            return $y <= $fadeStart || $blockTop <= $fadeStart ? 0.0 : $scrimEnd * ($y - $fadeStart) / ($blockTop - $fadeStart);
        };

        $logoWidth = min($width * (float) $check['logo_width_share'], (float) $check['logo_max_width']);
        $logoHeight = $logoWidth / (float) $check['logo_aspect'];
        $logoLeft = ($width - $logoWidth) / 2;
        $logoTop = $height * (float) $check['logo_top'];

        $logo = [];
        $text = [];

        for ($y = 0; $y < $h; $y++) {
            $pointY = $y / self::SCALE;
            $inLogoRows = $pointY >= $logoTop && $pointY < $logoTop + $logoHeight;
            $inText = $pointY >= $blockTop;

            if (! $inLogoRows && ! $inText) {
                continue;
            }

            for ($x = 0; $x < $w; $x++) {
                $color = imagecolorat($canvas, $x, $y);
                $rgb = [(($color >> 16) & 0xFF) / 255, (($color >> 8) & 0xFF) / 255, ($color & 0xFF) / 255];
                $pointX = $x / self::SCALE;

                if ($inLogoRows && $pointX >= $logoLeft && $pointX < $logoLeft + $logoWidth) {
                    $ground = $this->darken($rgb, max($shadowMin, $scrim($pointY)));
                    $logo[] = $this->contrast([1.0, 1.0, 1.0], $ground);
                }

                if ($inText) {
                    $ground = $this->darken($rgb, $scrim($pointY));
                    $ink = array_map(fn (float $channel): float => $textAlpha + (1 - $textAlpha) * $channel, $ground);
                    $text[] = $this->contrast($ink, $ground);
                }
            }
        }

        imagedestroy($canvas);

        return [$this->low($logo), $this->low($text)];
    }

    /**
     * FS-1's cover crop, centred on the focal point as far as the photo allows (expo-image contentPosition).
     */
    private function cover(GdImage $source, int $width, int $height, float $focalX, float $focalY): GdImage
    {
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = max($width / $sourceWidth, $height / $sourceHeight);
        $cropWidth = $width / $scale;
        $cropHeight = $height / $scale;
        $left = max(0.0, min($sourceWidth - $cropWidth, $focalX * $sourceWidth - $cropWidth / 2));
        $top = max(0.0, min($sourceHeight - $cropHeight, $focalY * $sourceHeight - $cropHeight / 2));

        $canvas = imagecreatetruecolor(max(1, $width), max(1, $height));
        imagecopyresampled($canvas, $source, 0, 0, (int) round($left), (int) round($top), $width, $height, (int) round($cropWidth), (int) round($cropHeight));

        return $canvas;
    }

    /**
     * @param  array{0: float, 1: float, 2: float}  $rgb
     * @return array{0: float, 1: float, 2: float}
     */
    private function darken(array $rgb, float $alpha): array
    {
        return [$rgb[0] * (1 - $alpha), $rgb[1] * (1 - $alpha), $rgb[2] * (1 - $alpha)];
    }

    /**
     * WCAG 2 contrast of two sRGB colours (channels 0–1).
     *
     * @param  array<int, float>  $a
     * @param  array<int, float>  $b
     */
    private function contrast(array $a, array $b): float
    {
        $la = $this->luminance($a);
        $lb = $this->luminance($b);

        return (max($la, $lb) + 0.05) / (min($la, $lb) + 0.05);
    }

    /**
     * @param  array<int, float>  $rgb
     */
    private function luminance(array $rgb): float
    {
        $linear = array_map(fn (float $c): float => $c <= 0.04045 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4, $rgb);

        return 0.2126 * $linear[0] + 0.7152 * $linear[1] + 0.0722 * $linear[2];
    }

    /**
     * @param  list<float>  $values
     */
    private function low(array $values): float
    {
        if ($values === []) {
            return 21.0;
        }

        sort($values);

        return $values[(int) floor((count($values) - 1) * self::PERCENTILE)];
    }

    private function minimum(): float
    {
        return (float) config('speedclub.brand.hero_check.minimum');
    }

    /**
     * The 1080 variant (what a phone shows), else the largest one.
     */
    private function bytes(BrandAsset $asset): string
    {
        $variants = $asset->variants;
        ksort($variants, SORT_NUMERIC);
        $path = $variants[1080] ?? end($variants);

        return (string) Storage::disk(config()->string('speedclub.brand.public_disk'))->get((string) $path);
    }
}
