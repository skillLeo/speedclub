<?php

namespace App\Enums;

/**
 * CF-6 (VEH-07): what a share card can show besides the photo, the make and the model (ShareCardOptions::$show).
 */
enum ShareCardElement: string
{
    case Score = 'score';
    case Dex = 'dex';
    case Specs = 'specs';
    // R5-2e: "12 Mods" and up to two of the build's mods; off by default (ShareCardOptions::DEFAULT_SHOW).
    case Mods = 'mods';
    case Username = 'username';
    case Qr = 'qr';
}
