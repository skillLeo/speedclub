<?php

namespace App\Enums;

/**
 * Staff actions on events (ADM-53/54, 09 §10.3), each written with Audit::record and labelled in lang/admin/{de,en}/audit.json.
 */
enum EventAuditEvent: string
{
    case Approved = 'event.approved';
    case Rejected = 'event.rejected';
    case CancelledByStaff = 'event.cancelled_by_staff';
    case Reopened = 'event.reopened';
    // M4.17: staff opened the exact place of an after_rsvp event (ADM-53 pane, ADM-54); once per staff member, event and day.
    case PrivatePlaceViewed = 'event.private_place_viewed';
}
