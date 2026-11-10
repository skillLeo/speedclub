<?php

namespace App\Enums;

/**
 * Audit actions of the four-eyes engine (ADR-214). The executed action writes its own event as well, naming requester and approver.
 */
enum ApprovalEvent: string
{
    case Requested = 'approval.requested';
    case Approved = 'approval.approved';
    case Failed = 'approval.failed';
    case Denied = 'approval.denied';
    case Expired = 'approval.expired';
    case Cancelled = 'approval.cancelled';
    case ExportDownloaded = 'approval.export_downloaded';
}
