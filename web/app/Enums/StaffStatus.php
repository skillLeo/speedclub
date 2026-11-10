<?php

namespace App\Enums;

/**
 * Only active staff may sign in or keep a session (EnsureStaffActive). Suspended is temporary, deactivated is the end of an account
 * (ADM-39); neither is ever deleted, because the audit log names them.
 */
enum StaffStatus: string
{
    case Active = 'active';
    case Suspended = 'suspended';
    case Deactivated = 'deactivated';
}
