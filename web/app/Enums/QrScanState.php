<?php

namespace App\Enums;

/**
 * What a scan of a code leads to (WEB-06, 02_PRODUCT_SPEC §3.4, F4).
 */
enum QrScanState: string
{
    case Active = 'active';
    case Revoked = 'revoked';
    case Private = 'private';
    case NotFound = 'not_found';
}
