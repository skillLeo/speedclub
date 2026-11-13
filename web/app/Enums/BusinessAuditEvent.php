<?php

namespace App\Enums;

/**
 * Staff decisions on business profiles (ADM-55/56, 09 §8.10), each written with Audit::record (reason included) and labelled in
 * lang/admin/{de,en}/audit.json. A suspension is four-eyes (business.suspend): its event names requester and approver.
 */
enum BusinessAuditEvent: string
{
    case Verified = 'business.verified';
    case Rejected = 'business.rejected';
    case Suspended = 'business.suspended';
    case Reinstated = 'business.reinstated';
    case Reopened = 'business.reopened';
}
