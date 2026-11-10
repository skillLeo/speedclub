<?php

namespace App\Models;

use Spatie\Permission\Models\Permission as SpatiePermission;

/**
 * Permission atoms exist for staff only: new records default to guard "staff".
 */
class Permission extends SpatiePermission
{
    protected string $guard_name = 'staff';
}
