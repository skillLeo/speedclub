<?php

use App\Models\Permission;
use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Spatie\Permission\PermissionRegistrar;

/**
 * Shared by the tests of tests/Feature/Staff and tests/Unit/Approvals (M3.1). Functions are prefixed m31 so they cannot collide with
 * helpers of other suites.
 */
/** The roles and atoms of StaffSeeder, without its accounts. */
function m31Roles(): void
{
    if (Role::query()->where('guard_name', StaffSeeder::GUARD)->exists()) {
        return;
    }

    foreach (StaffSeeder::ATOMS as $atom) {
        Permission::findOrCreate($atom, StaffSeeder::GUARD);
    }

    foreach (['owner', 'admin'] as $role) {
        Role::findOrCreate($role, StaffSeeder::GUARD)->syncPermissions(StaffSeeder::ATOMS);
    }

    foreach (StaffSeeder::ROLES as $role => $atoms) {
        Role::findOrCreate($role, StaffSeeder::GUARD)->syncPermissions($atoms);
    }

    app(PermissionRegistrar::class)->forgetCachedPermissions();
}

/** A staff member with TOTP confirmed and the given role (owner, admin, moderator, support, content_editor, analyst). */
function m31Staff(?string $role = null, bool $confirmed = true, array $attributes = []): Staff
{
    m31Roles();
    $factory = Staff::factory();
    $staff = ($confirmed ? $factory->twoFactorConfirmed() : $factory)->create($attributes);

    if ($role !== null) {
        $staff->assignRole($role);
    }

    return $staff->fresh() ?? $staff;
}

/** @return array<string, mixed> */
function m31ConfirmedPassword(): array
{
    return ['auth.password_confirmed_at' => time()];
}

/** The roles of 06_ADMIN_SPEC §2. */
const M31_ROLES = ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'];
