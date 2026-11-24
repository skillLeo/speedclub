<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * 10 §2.3 sizes S/M/L; the millimetres per template come from StickerCatalogue.
 */
enum StickerSize: string
{
    use HasLabel;

    case S = 's';
    case M = 'm';
    case L = 'l';

    /**
     * Every template is one layout scaled uniformly: S is its base size.
     */
    public function scale(): float
    {
        return match ($this) {
            self::S => 1.0,
            self::M => 1.3,
            self::L => 1.6,
        };
    }
}
