<?php

namespace Tests\Support;

use RuntimeException;

/**
 * Real image bytes for the media tests, including a JPEG with a hand-built EXIF block (orientation and GPS).
 */
final class TestImages
{
    public static function jpeg(int $width = 2400, int $height = 1600): string
    {
        return self::encode($width, $height, 'jpeg');
    }

    public static function png(int $width = 1200, int $height = 800): string
    {
        return self::encode($width, $height, 'png');
    }

    public static function webp(int $width = 1200, int $height = 800): string
    {
        return self::encode($width, $height, 'webp');
    }

    public static function gif(int $width = 64, int $height = 64): string
    {
        return self::encode($width, $height, 'gif');
    }

    /**
     * A JPEG carrying Orientation and GPSLatitude N 52° 31' in an APP1 EXIF segment. Tests assert with exif_read_data()
     * that the fixture really holds them, so "no GPS in the output" proves something.
     */
    public static function jpegWithGps(int $width = 2400, int $height = 1600, int $orientation = 1): string
    {
        $tiff = 'II*'."\0".pack('V', 8);
        // IFD0 at 8: two entries (12 bytes each) and the next-IFD pointer, so the GPS IFD starts at 38.
        $tiff .= pack('v', 2);
        $tiff .= pack('vvVv', 0x0112, 3, 1, $orientation)."\0\0";
        $tiff .= pack('vvVV', 0x8825, 4, 1, 38);
        $tiff .= pack('V', 0);
        // GPS IFD at 38: rationals follow at 38 + 2 + 24 + 4 = 68.
        $tiff .= pack('v', 2);
        $tiff .= pack('vvV', 1, 2, 2).'N'."\0\0\0";
        $tiff .= pack('vvVV', 2, 5, 3, 68);
        $tiff .= pack('V', 0);
        $tiff .= pack('VVVVVV', 52, 1, 31, 1, 0, 1);

        $segment = 'Exif'."\0\0".$tiff;

        return substr_replace(self::jpeg($width, $height), "\xFF\xE1".pack('n', strlen($segment) + 2).$segment, 2, 0);
    }

    /**
     * Left half red, right half blue, so a rotation shows in the pixels.
     */
    private static function encode(int $width, int $height, string $format): string
    {
        $image = imagecreatetruecolor($width, $height);

        if ($image === false) {
            throw new RuntimeException('GD could not create an image.');
        }

        imagefilledrectangle($image, 0, 0, (int) ($width / 2), $height, (int) imagecolorallocate($image, 200, 20, 20));
        imagefilledrectangle($image, (int) ($width / 2) + 1, 0, $width, $height, (int) imagecolorallocate($image, 20, 20, 200));

        ob_start();

        match ($format) {
            'jpeg' => imagejpeg($image, null, 90),
            'png' => imagepng($image),
            'webp' => imagewebp($image, null, 80),
            'gif' => imagegif($image),
        };

        return (string) ob_get_clean();
    }
}
