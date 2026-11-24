<?php

namespace App\Enums;

/**
 * R4-2.3 crews: the member-side changes of a crew (the member as actor) and staff measures (the staff member as actor, a reason given),
 * each written with Audit::record, the crew as target, and labelled in lang/admin/{de,en}/audit.json.
 */
enum CrewAuditEvent: string
{
    case Created = 'crew.created';
    case Updated = 'crew.updated';
    case Deleted = 'crew.deleted';
    case FounderTransferred = 'crew.founder_transferred';
    case RoleChanged = 'crew.role_changed';
    case MemberRemoved = 'crew.member_removed';
    case Hidden = 'crew.hidden';
    case Unhidden = 'crew.unhidden';
    case Removed = 'crew.removed';
    case Restored = 'crew.restored';
}
