<?php

namespace App\Enums;

/**
 * Who an announcement of ADM-30 is for. app-config is public and cached, so the app decides per member: `new` = registered within
 * the last 14 days, `with_vehicles` = has at least one vehicle; guests see only `all`.
 */
enum AnnouncementAudience: string
{
    case All = 'all';
    case New = 'new';
    case WithVehicles = 'with_vehicles';
}
