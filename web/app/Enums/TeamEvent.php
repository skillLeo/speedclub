<?php

namespace App\Enums;

/**
 * Audit actions of M3.6 Team & roles (ADM-39…42). Staff security events of the staff member's own account are StaffSecurityEvent.
 * No password, token, code or recovery code ever reaches the row.
 */
enum TeamEvent: string
{
    case Invited = 'staff.invited';
    case InviteResent = 'staff.invite_resent';
    case InviteAccepted = 'staff.invite_accepted';
    case RolesChanged = 'staff.roles_changed';
    case Deactivated = 'staff.deactivated';
    case Reactivated = 'staff.reactivated';
    case Deleted = 'staff.deleted';
    case SessionsRevoked = 'staff.sessions_revoked';
    /** ADR-238: a lost authenticator reset by two Owners (staff.reset_two_factor). */
    case TwoFactorReset = 'staff.two_factor_reset';
    case RoleCreated = 'role.created';
    case RoleUpdated = 'role.updated';
    case RoleDeleted = 'role.deleted';
    case PermissionsChanged = 'permissions.changed';
}
