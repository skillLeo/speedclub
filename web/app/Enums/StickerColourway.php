<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * 10 §2.3: white print for dark glass, black print for light paint, white with a Signal-Red accent.
 */
enum StickerColourway: string
{
    use HasLabel;

    case White = 'white';
    case Black = 'black';
    case WhiteRed = 'white_red';

    /**
     * White ink is printed on transparent vinyl for dark glass; on white vinyl it would have no contrast at all.
     *
     * @return list<StickerMaterial>
     */
    public function materials(): array
    {
        return $this === self::Black ? [StickerMaterial::Transparent, StickerMaterial::WhiteVinyl] : [StickerMaterial::Transparent];
    }

    /**
     * The ink the logo, the text and the QR field are printed in: white for the white colourways, black otherwise.
     */
    public function isWhiteInk(): bool
    {
        return $this !== self::Black;
    }
}
