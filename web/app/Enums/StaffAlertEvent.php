<?php

namespace App\Enums;

/**
 * Audit events of the queued staff alerts (StaffAlerts, DeliverStaffAlert): each mail sent, or given up after its retries.
 */
enum StaffAlertEvent: string
{
    case Sent = 'staff_alert.sent';
    case Failed = 'staff_alert.failed';
}
