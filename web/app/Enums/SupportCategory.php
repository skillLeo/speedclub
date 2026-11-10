<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * SET-15 and WEB-10; ADM-25 sorts the queue by it.
 */
enum SupportCategory: string
{
    use HasLabel;

    case Account = 'account';
    case Vehicle = 'vehicle';
    case Qr = 'qr';
    case Messaging = 'messaging';
    case Safety = 'safety';
    case Other = 'other';
}
