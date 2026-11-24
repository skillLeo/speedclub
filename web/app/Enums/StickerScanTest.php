<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The server's Scan-Test of a sticker design (m5.4-contract §4): the print raster decoded back to the code, or no code to test.
 */
enum StickerScanTest: string
{
    use HasLabel;

    case Passed = 'passed';
    case Failed = 'failed';
    case NotApplicable = 'not_applicable';
}
