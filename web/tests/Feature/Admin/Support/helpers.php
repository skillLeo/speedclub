<?php

use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

/**
 * Shared by the admin feature tests (lane b). Roles and atoms come from the real StaffSeeder, so a matrix test follows the seeded
 * role bundles of 06 §2.
 */
const ADMIN_ROLES = ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'];

function seedStaffRoles(): void
{
    test()->seed(StaffSeeder::class);
}

/** A staff member with confirmed TOTP and the given role (null = no role). */
function staffWithRole(?string $role, bool $totp = true): Staff
{
    $factory = Staff::factory();
    $staff = ($totp ? $factory->twoFactorConfirmed() : $factory)->create();

    if ($role !== null) {
        $staff->assignRole($role);
    }

    return $staff->fresh() ?? $staff;
}

/** Signed in as a session that has shown its TOTP code (what EnsureStaffTwoFactor expects of a confirmed account). */
function actingAsStaff(Staff $staff): mixed
{
    return test()->actingAs($staff, 'staff');
}

function assertAdminErrorPage(TestResponse $response, int $status): void
{
    $response->assertStatus($status)->assertInertia(fn (AssertableInertia $page) => $page->component('Error')->where('status', $status));
}

/**
 * The authorisation matrix of one admin route (contract §0): guest → sign-in, staff without TOTP → enrolment, each role →
 * allowed or 403. Suspended staff → signed out is proved per route group in OverviewPagesTest (staff.active sits on the group).
 *
 * @param  list<string>  $allowed  roles that may use the route
 * @param  array<string, mixed>  $data
 * @param  Closure(TestResponse, string): void  $assertAllowed
 */
function assertAdminMatrix(string $method, string $uri, array $allowed, Closure $assertAllowed, array $data = []): void
{
    seedStaffRoles();
    $call = fn (): TestResponse => test()->call($method, $uri, $data);

    // guest
    $guest = $call();
    expect($guest->status())->toBeIn([302, 303]);
    expect((string) $guest->headers->get('Location'))->toEndWith('/admin/login');

    // staff without TOTP
    actingAsStaff(staffWithRole('owner', totp: false));
    $enrol = $call();
    expect($enrol->status())->toBeIn([302, 303]);
    expect((string) $enrol->headers->get('Location'))->toEndWith('/admin/two-factor/setup');
    auth('staff')->logout();

    foreach (ADMIN_ROLES as $role) {
        app('auth')->forgetGuards();
        actingAsStaff(staffWithRole($role));
        $response = $call();

        if (in_array($role, $allowed, true)) {
            $assertAllowed($response, $role);
        } else {
            assertAdminErrorPage($response, 403);
        }
        auth('staff')->logout();
    }
}
