<?php

namespace App\Services\Stickers;

use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Common\GDLuminanceSource;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use GdImage;
use Throwable;

/**
 * The server half of the Scan-Test (m5.4-contract §4): the whole sticker rasterised as a camera sees it on its surface, at a fixed number
 * of pixels per module (and, when that read fails, at the neighbouring scales, ADR-534), and decoded with the QR reader of the stack
 * (chillerlan/php-qrcode, GD, pure PHP: runs on the shared host). Passes when the text read back is the expected payload and the code
 * carries error correction H.
 */
class StickerScanner
{
    public function __construct(private readonly StickerRaster $raster) {}

    /**
     * @return array{passed: bool, decoded: string|null}
     */
    public function test(StickerArtwork $artwork, string $expected): array
    {
        $qr = $artwork->qr();

        if ($qr === null) {
            return ['passed' => false, 'decoded' => null];
        }

        $moduleMm = (float) ($qr['size'] ?? 1.0) / ((int) ($qr['modules'] ?? 21) + 2 * StickerCatalogue::QUIET_ZONE_MODULES);
        $result = ['passed' => false, 'decoded' => null];

        foreach (self::scales() as $pxPerModule) {
            $image = $this->raster->render($artwork, $pxPerModule / $moduleMm, 'seen', (int) ceil(2 * $pxPerModule));
            $result = $this->decode($image, $expected);

            if ($result['passed']) {
                return $result;
            }
        }

        return $result;
    }

    /**
     * The pixels per module the reader tries in turn (ADR-534): the configured one, then one coarser and one finer, as a camera a little
     * farther away or closer sees the sticker. The reader's detector misjudges the finder patterns of a few valid codes at some scales
     * only ("estimated dimension"): V3VX6HGX on the plate template fails at 4 px and reads at 2 and 3 px, and ZXing, the reader of the
     * phones, reads it at every scale. One scale alone failed the Scan-Test, and with it the order, of a sticker any phone reads. Each
     * try still has to read back exactly the payload with error correction H.
     *
     * @return list<int>
     */
    public static function scales(): array
    {
        $configured = max(2, config()->integer('speedclub.stickers.decode_px_per_module', 4));

        return array_values(array_unique([$configured, max(2, $configured - 1), $configured + 1]));
    }

    /**
     * @return array{passed: bool, decoded: string|null}
     */
    public function decode(GdImage $image, string $expected): array
    {
        try {
            $options = new QROptions;
            $result = (new QRCode($options))->readFromSource(new GDLuminanceSource($image, $options));
        } catch (Throwable) {
            return ['passed' => false, 'decoded' => null];
        }

        return [
            'passed' => $result->data === $expected && $result->eccLevel->getLevel() === EccLevel::H,
            'decoded' => $result->data,
        ];
    }
}
