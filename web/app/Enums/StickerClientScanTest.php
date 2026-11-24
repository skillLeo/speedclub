<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * What the app reports from its own on-device decode (10 §2.3); informational, the server test decides.
 */
enum StickerClientScanTest: string
{
    use HasLabel;

    case Passed = 'passed';
    case Failed = 'failed';
    case Unavailable = 'unavailable';
}
