<?php

namespace App\Services\Stickers;

use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Common\Mode;
use chillerlan\QRCode\QRCode;
use chillerlan\QRCode\QROptions;
use RuntimeException;

/**
 * The modules of a sticker code: error correction H (10 §2.3), no quiet zone (the layout draws it, 4 modules), the smallest mode the
 * payload fits, as QRCode::render() picks it (QrCodes::payload is uppercase for alphanumeric mode, ADR-027).
 */
final class StickerQrMatrix
{
    /**
     * @return list<list<bool>> rows of dark (true) and light modules
     */
    public static function of(string $payload): array
    {
        $qr = new QRCode(new QROptions(['eccLevel' => EccLevel::H, 'addQuietzone' => false]));

        foreach (Mode::INTERFACES as $interface) {
            if ($interface::validateString($payload)) {
                $qr->addSegment(new $interface($payload));

                return array_values(array_map(array_values(...), $qr->getQRMatrix()->getBooleanMatrix()));
            }
        }

        throw new RuntimeException('The sticker payload fits no QR mode.');
    }
}
