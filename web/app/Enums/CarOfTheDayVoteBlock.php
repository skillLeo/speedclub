<?php

namespace App\Enums;

/**
 * R4-2.1 (contract-cotd-voting V4): why this member cannot vote right now (cannot_vote_reason). Null in the response means they can.
 */
enum CarOfTheDayVoteBlock: string
{
    case Closed = 'closed';
    case AccountTooNew = 'account_too_new';
    case EmailUnverified = 'email_unverified';
    case Restricted = 'restricted';
    case SampleAccount = 'sample_account';
}
