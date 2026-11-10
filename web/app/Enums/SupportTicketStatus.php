<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * Open until the team answers (pending: waiting for the member) or closes it (ADM-25, Phase 3).
 */
enum SupportTicketStatus: string
{
    use HasLabel;

    case Open = 'open';
    case Pending = 'pending';
    case Closed = 'closed';
}
