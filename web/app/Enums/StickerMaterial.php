<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * 10 §2.3 material note for the printer.
 */
enum StickerMaterial: string
{
    use HasLabel;

    case Transparent = 'transparent';
    case WhiteVinyl = 'white_vinyl';
}
