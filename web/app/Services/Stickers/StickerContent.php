<?php

namespace App\Services\Stickers;

/**
 * What a sticker prints besides the logo: the QR payload (null = no code) and the lines the options switched on. Resolved from a
 * vehicle by StickerContents; the layout never looks anything up itself.
 */
final readonly class StickerContent
{
    public function __construct(
        public ?string $payload,
        public ?string $username,
        public ?string $carName,
        public ?string $customLine,
    ) {}
}
