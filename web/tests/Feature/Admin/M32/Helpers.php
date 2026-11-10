<?php

use App\Models\Staff;
use App\Models\User;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Moderation/ModerationTestHelpers.php';

/**
 * M3.2 admin HTTP tests (lane b). Functions are prefixed adm32 so they never collide with the lane-a helpers (m32…).
 */
function adm32Reason(): string
{
    return 'Ticket 4711: Beschwerden mehrerer Mitglieder geprüft.';
}

/** The statement-of-reasons fields of Statement::rules(). */
function adm32Statement(): array
{
    return [
        'facts' => 'Wiederholt beleidigende Nachrichten an andere Mitglieder.',
        'ground' => 'Respektvoller Umgang',
        'ground_document' => 'community',
        'ground_section' => '2',
    ];
}

function adm32Member(array $attributes = []): User
{
    return User::factory()->create(['username' => 'jonas.adm', 'email' => 'jonas.adm@gmail.de', 'locale' => 'de', ...$attributes]);
}

/** Staff of a role, signed in, with a password confirmed just now (ADR-215). */
function adm32SignedIn(string $role): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

/**
 * The authorisation matrix of a write: like assertAdminMatrix, with a fresh password confirmation, so the atom alone decides.
 *
 * @param  list<string>  $allowed
 * @param  array<string, mixed>  $data
 */
function adm32WriteMatrix(string $method, string $uri, array $allowed, array $data = [], ?Closure $assertAllowed = null): void
{
    test()->withSession(['auth.password_confirmed_at' => time()]);
    assertAdminMatrix($method, $uri, $allowed, $assertAllowed ?? fn ($r) => expect($r->status())->toBeIn([200, 302, 303, 404, 409, 422]), $data);
}
