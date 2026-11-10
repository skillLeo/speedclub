<?php

use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Spatie\Permission\PermissionRegistrar;

require_once __DIR__.'/../Actions/Helpers.php';
require_once __DIR__.'/../M34/Helpers.php';

/**
 * Phase 3 server fix round (plan "Queue: next backend round"), lane a. Functions are prefixed m3q so they never collide with
 * another suite's helpers.
 */
function m3qStaffWith(string ...$atoms): Staff
{
    m31Roles();
    $role = Role::findOrCreate('m3q-'.implode('-', $atoms), StaffSeeder::GUARD);
    $role->syncPermissions($atoms);
    app(PermissionRegistrar::class)->forgetCachedPermissions();

    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $staff->assignRole($role);

    return $staff->fresh() ?? $staff;
}
