<?php

namespace App\Models;

use Spatie\Permission\Models\Role as SpatieRole;

/**
 * Roles exist for staff only: new records default to guard "staff".
 */
class Role extends SpatieRole
{
    protected string $guard_name = 'staff';
}
