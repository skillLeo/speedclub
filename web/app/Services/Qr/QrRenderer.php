<?php

namespace App\Services\Qr;

use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Output\QRGdImagePNG;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use GdImage;
use RuntimeException;

/**
 * Always black on white, quiet zone of 4 modules, error correction Q, nothing inside the code (ADR-027). Server-rendered, so every
 * platform gets the same modules. The library picks alphanumeric mode by itself when the whole string fits it (Mode::INTERFACES),
 * which is why QrCodes::payload is uppercase.
 */
class QrRenderer
{
    public const QUIET_ZONE = 4;

    public const PNG_SIZES = [1024, 2048];

    public function svg(string $payload): string
    {
        $svg = (new QRCode($this->options([
            'outputInterface' => CompactSvg::class,
            'svgUseFillAttributes' => true,
            'svgAddXmlHeader' => true,
        ])))->render($payload);

        return is_string($svg) ? $svg : throw new RuntimeException('The QR library returned no SVG.');
    }

    /**
     * Exactly $size square. Modules are whole pixels and stay crisp, so what does not divide evenly goes to the white margin.
     *
     * @param  int<1, max>  $size
     */
    public function png(string $payload, int $size): string
    {
        $moduleCount = imagesx($this->image($payload, 1));
        $code = $this->image($payload, (int) floor($size / $moduleCount));

        $canvas = imagecreatetruecolor($size, $size);

        if ($canvas === false) {
            throw new RuntimeException('GD could not create the QR canvas.');
        }

        imagefilledrectangle($canvas, 0, 0, $size, $size, (int) imagecolorallocate($canvas, 255, 255, 255));

        $offset = (int) floor(($size - imagesx($code)) / 2);
        imagecopy($canvas, $code, $offset, $offset, 0, 0, imagesx($code), imagesy($code));

        ob_start();
        imagepng($canvas, null, 9);

        return (string) ob_get_clean();
    }

    private function image(string $payload, int $scale): GdImage
    {
        $image = (new QRCode($this->options([
            'outputInterface' => QRGdImagePNG::class,
            'returnResource' => true,
            'scale' => $scale,
            'bgColor' => [255, 255, 255],
            'imageTransparent' => false,
        ])))->render($payload);

        return $image instanceof GdImage ? $image : throw new RuntimeException('The QR library returned no image.');
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function options(array $extra = []): QROptions
    {
        return new QROptions([
            'eccLevel' => EccLevel::Q,
            'addQuietzone' => true,
            'quietzoneSize' => self::QUIET_ZONE,
            'drawLightModules' => true,
            'outputBase64' => false,
            ...$extra,
        ]);
    }
}
