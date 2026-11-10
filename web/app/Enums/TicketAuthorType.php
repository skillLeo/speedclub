<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum TicketAuthorType: string
{
    use HasLabel;

    case Member = 'member';
    case Guest = 'guest';
    case Staff = 'staff';
}
