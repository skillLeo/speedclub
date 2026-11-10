<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Why a member may not write to another (403 cannot_message, `reason`). A block answers recipient_closed, the same as "Niemand" or
 * "Mitglieder, denen ich folge", so the answer never reveals the block (m2.4-contract §1).
 */
enum CannotMessageReason: string
{
    use HasLabel;

    case RecipientClosed = 'recipient_closed';
    case NotVerified = 'not_verified';
    case Restricted = 'restricted';
}
