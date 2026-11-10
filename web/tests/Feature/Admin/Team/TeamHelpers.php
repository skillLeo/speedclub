<?php

use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use Database\Seeders\StaffSeeder;
use Spatie\Permission\Models\Role;

require_once __DIR__.'/../../Staff/Helpers.php';

/**
 * M3.6 Team, privacy, system, account, settings and memberships tests (lane a). Functions are prefixed m36.
 */
function m36Reason(): string
{
    return 'Neue Aufgabenverteilung im Team ab Montag.';
}

function m36Approve(ApprovalRequest $request, Staff $approver): ApprovalRequest
{
    return app(Approvals::class)->approve($request, $approver);
}

/** A staff member holding exactly $atoms through a role made for the test. */
function m36StaffWith(string ...$atoms): Staff
{
    m31Roles();
    $role = Role::findOrCreate('m36-'.md5(implode('|', $atoms)), StaffSeeder::GUARD);
    $role->syncPermissions($atoms);

    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $staff->assignRole($role);

    return $staff->fresh() ?? $staff;
}

/**
 * Each role of 06 §2 and whether it holds all of $atoms.
 *
 * @return array<string, array{0: string, 1: bool}>
 */
function m36Matrix(string ...$atoms): array
{
    $rows = [];

    foreach (M31_ROLES as $role) {
        $rows[$role] = [$role, in_array($role, ['owner', 'admin'], true) || array_diff($atoms, StaffSeeder::ROLES[$role] ?? []) === []];
    }

    return $rows;
}

/** @return list<string> */
function m36Roles(Staff $staff): array
{
    return $staff->fresh()?->roles()->pluck('name')->sort()->values()->all() ?? [];
}
