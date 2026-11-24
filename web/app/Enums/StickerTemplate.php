<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The six designer templates of 10 §2.3 (STK-05), all on the unchanged logo. Geometry and sizes in App\Services\Stickers\StickerCatalogue.
 */
enum StickerTemplate: string
{
    use HasLabel;

    case Classic = 'classic';
    case Minimal = 'minimal';
    case Banner = 'banner';
    case Plate = 'plate';
    case VerticalJdm = 'vertical_jdm';
    case Round = 'round';
}
