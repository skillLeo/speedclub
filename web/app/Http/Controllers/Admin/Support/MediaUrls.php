<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\Media;
use App\Services\Media\MediaService;
use kornrunner\Blurhash\Blurhash;
use Throwable;

/**
 * Picture URLs for admin lists and queues: the public variant closest to (and not below) the width a cell needs. A photo a decision
 * removed has no public variants any more (ADR-123): null, and the page shows its placeholder.
 */
final class MediaUrls
{
    public static function at(?Media $media, int $width): ?string
    {
        if (! $media instanceof Media) {
            return null;
        }

        $urls = app(MediaService::class)->variantUrls($media);

        foreach ($urls as $size => $url) {
            if ($size >= $width) {
                return $url;
            }
        }

        return $urls === [] ? null : end($urls);
    }

    /**
     * The photo's blurhash as a tiny PNG data URI (the browser blurs it by scaling it up), for the placeholder under a thumbnail or a
     * removed photo. Null without a readable blurhash. Only base64 leaves here, never a path.
     */
    public static function placeholder(?Media $media, int $width = 8, int $height = 6): ?string
    {
        $hash = $media?->getAttribute('blurhash');
        if (! is_string($hash) || $hash === '' || $width < 1 || $height < 1 || $width > 64 || $height > 64) {
            return null;
        }

        try {
            $pixels = Blurhash::decode($hash, $width, $height);
            $image = imagecreatetruecolor($width, $height);
            if ($image === false) {
                return null;
            }
            foreach ($pixels as $y => $row) {
                foreach ($row as $x => [$red, $green, $blue]) {
                    imagesetpixel($image, $x, $y, (int) imagecolorallocate($image, max(0, min(255, (int) $red)), max(0, min(255, (int) $green)), max(0, min(255, (int) $blue))));
                }
            }
            ob_start();
            imagepng($image, null, 9);

            return 'data:image/png;base64,'.base64_encode((string) ob_get_clean());
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The focal point (GAR-08) as a CSS object-position, "50% 38%"; null when the member never set one (the page centres the crop).
     */
    public static function focus(?Media $media): ?string
    {
        $x = $media?->getAttribute('focal_x');
        $y = $media?->getAttribute('focal_y');
        if (! is_numeric($x) && ! is_numeric($y)) {
            return null;
        }
        $percent = fn (mixed $v): int => (int) round(max(0.0, min(1.0, is_numeric($v) ? (float) $v : 0.5)) * 100);

        return $percent($x).'% '.$percent($y).'%';
    }
}
