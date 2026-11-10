<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum SupportTicketSource: string
{
    use HasLabel;

    // SET-15, a signed-in member.
    case App = 'app';
    // WEB-10 /kontakt, a guest.
    case Web = 'web';
}
