<?php

namespace App\Enums;

/**
 * Four-eyes requests (ADR-214). Only pending can change: approve executes it (executed, or failed when the re-validation or the action
 * refuses), deny and cancel end it, and after 24 hours approvals:expire ends it. A handler that runs record by record
 * (RunsRecordByRecord: the bulk actions) is `executing` between the approval and the end of its run; approvals:expire ends one that
 * stopped half-way (the PHP request was killed) as failed.
 */
enum ApprovalStatus: string
{
    case Pending = 'pending';
    case Executing = 'executing';
    case Executed = 'executed';
    case Failed = 'failed';
    case Denied = 'denied';
    case Expired = 'expired';
    case Cancelled = 'cancelled';
}
