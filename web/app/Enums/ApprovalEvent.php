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
    /**
     * ADR-507: an Owner executed their own request because no second eligible approver exists (reason, alert mail). Written instead of
     * `approval.approved` (SEC-P5-04), so a filter on approvals never counts an override as a four-eyes approval.
     */
    case OwnerOverride = 'approval.owner_override';
    /** SEC-P5-03: the Owner-Override switch of ADM-52 Governance was turned on or off (alert mail to Owners and Admins). */
    case OwnerOverrideSwitched = 'approval.owner_override_switched';
    /**
     * ADR-540: four-eyes is off, so the request ran at once with its requester as the executor (a direct action, never counted as a
     * four-eyes approval), next to the action's own event.
     */
    case Direct = 'approval.direct';
    /** ADR-540: "Vier-Augen-Prinzip" of ADM-52 Governance was turned on or off. */
    case FourEyesSwitched = 'approval.four_eyes_switched';
}
