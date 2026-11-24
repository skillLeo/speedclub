<?php

namespace App\Enums;

/**
 * The security mails to staff that go through the queue with retries and a record per recipient (StaffAlerts, SF-5 of the M5.1 review).
 */
enum StaffAlertKind: string
{
    /** ADR-507: an Owner executed their own four-eyes request (Owners, Admins, recent approvers). */
    case OwnerOverride = 'owner_override';
    /** SEC-P5-03: the Owner-Override switch of ADM-52 Governance changed (Owners and Admins). */
    case OverrideSwitch = 'override_switch';
    /** SEC-P5-07: someone took over a config draft (its former author). */
    case DraftTakenOver = 'draft_taken_over';
}
