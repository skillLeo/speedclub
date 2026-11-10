<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-06: an app sign-in is a Sanctum token, a browser sign-in is a cookie session.
 */
enum SessionKind: string
{
    use HasLabel;

    case App = 'app';
    case Web = 'web';
}
