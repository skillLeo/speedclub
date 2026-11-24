<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum RestrictionType: string
{
    use HasLabel;

    case Messaging = 'messaging';
    case Publishing = 'publishing';
    // M5.8 (m5.8-contract D3): the forum ban; writing in the forum only (threads, replies, votes), a DSA restriction like the others.
    case Forum = 'forum';
}
