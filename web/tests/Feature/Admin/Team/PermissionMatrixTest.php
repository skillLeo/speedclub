<?php

use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\DeleteRole;
use App\Actions\Admin\Team\SaveRole;
use App\Enums\ApprovalStatus;
use App\Enums\TeamEvent;
use App\Models\AuditEvent;
use App\Models\Role;
use App\Services\Team\PermissionMatrix;
use App\Services\Team\TeamRefused;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/TeamHelpers.php';

beforeEach(fn () => m31Roles());

/** @return list<string> */
function m36RoleAtoms(string $role): array
{
    return Role::findByName($role, StaffSeeder::GUARD)->permissions()->pluck('name')->sort()->values()->all();
}

it('shows the matrix with Owner and Admin locked and the sensitive atoms marked', function () {
    m31Staff('support');
    $matrix = app(PermissionMatrix::class)->matrix();
    $roles = collect($matrix['roles'])->keyBy('name');

    expect($matrix['atoms'])->toBe(StaffSeeder::ATOMS)
        ->and($matrix['sensitive'])->toBe(PermissionMatrix::SENSITIVE)
        ->and($roles['owner']['locked'])->toBeTrue()
        ->and($roles['admin']['locked'])->toBeTrue()
        ->and($roles['support']['locked'])->toBeFalse()
        ->and($roles['support']['staff'])->toBe(1);
});

it('diffs a proposal per role with the staff it reaches', function () {
    m31Staff('analyst');
    m31Staff('analyst');
    $atoms = [...StaffSeeder::ROLES['analyst'], 'lists.export'];

    $diff = app(PermissionMatrix::class)->diff(['analyst' => array_values(array_diff($atoms, ['qr.view']))]);

    expect($diff)->toBe(['analyst' => ['added' => ['lists.export'], 'removed' => ['qr.view'], 'before' => m36RoleAtoms('analyst'), 'staff' => 2]]);
});

it('lets only holders of roles.manage change the matrix', function (string $role, bool $allowed) {
    $run = fn () => app(ApplyPermissionMatrix::class)->handle(m31Staff($role), ['analyst' => [...StaffSeeder::ROLES['analyst'], 'lists.export']]);

    $allowed ? expect($run()->applied)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('roles.manage'));

it('applies plain grants and removals at once, audited', function () {
    app(ApplyPermissionMatrix::class)->handle(m31Staff('admin'), ['analyst' => ['analytics.view', 'members.view']]);

    expect(m36RoleAtoms('analyst'))->toBe(['analytics.view', 'members.view'])
        ->and(AuditEvent::query()->where('action', TeamEvent::PermissionsChanged->value)->sole()->after['changes']['analyst']['removed'])
        ->toBe(['moderation.view', 'qr.view', 'vehicles.view']);
});

it('makes granting a sensitive atom four-eyes', function (string $atom) {
    $requester = m31Staff('admin');
    $outcome = app(ApplyPermissionMatrix::class)->handle($requester, ['support' => [...StaffSeeder::ROLES['support'], $atom]], m36Reason());

    expect($outcome->approval?->action)->toBe('roles.sensitive_atoms')
        ->and(m36RoleAtoms('support'))->not->toContain($atom)
        ->and(fn () => m36Approve($outcome->approval, $requester))->toThrow(AuthorizationException::class);

    expect(m36Approve($outcome->approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
        ->and(m36RoleAtoms('support'))->toContain($atom);
})->with(PermissionMatrix::SENSITIVE);

it('fails a sensitive approval when the role changed in between', function () {
    $outcome = app(ApplyPermissionMatrix::class)->handle(m31Staff('admin'), ['support' => [...StaffSeeder::ROLES['support'], 'members.export']], m36Reason());
    Role::findByName('support', StaffSeeder::GUARD)->givePermissionTo('analytics.view');

    expect(m36Approve($outcome->approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Failed)
        ->and(m36RoleAtoms('support'))->not->toContain('members.export');
});

it('keeps Owner and Admin, unknown atoms and self-elevation out', function () {
    $admin = m31Staff('admin');

    expect(fn () => app(ApplyPermissionMatrix::class)->handle($admin, ['admin' => ['members.view']]))->toThrow(TeamRefused::class)
        ->and(fn () => app(ApplyPermissionMatrix::class)->handle($admin, ['support' => ['nope.atom']]))->toThrow(ValidationException::class)
        ->and(fn () => app(ApplyPermissionMatrix::class)->handle($admin, ['support' => StaffSeeder::ROLES['support']]))->toThrow(TeamRefused::class, __('team.refused.unchanged'));

    $manager = m36StaffWith('roles.manage', 'staff.view');
    $own = $manager->roles()->first()->name;
    expect(fn () => app(ApplyPermissionMatrix::class)->handle($manager, [$own => ['roles.manage', 'staff.view', 'audit.view']]))->toThrow(TeamRefused::class, __('team.refused.self_elevation'));
});

it('creates a custom role whose sensitive atoms wait for the approval, and deletes it when unused', function () {
    $admin = m31Staff('admin');

    $outcome = app(SaveRole::class)->handle($admin, null, 'Datenschutz', 'Bearbeitet DSGVO-Anfragen', ['privacy.view', 'privacy.process', 'members.export'], m36Reason());
    $role = Role::findByName('Datenschutz', StaffSeeder::GUARD);

    expect($outcome->approval?->action)->toBe('roles.sensitive_atoms')
        ->and($role->getAttribute('description'))->toBe('Bearbeitet DSGVO-Anfragen')
        ->and(m36RoleAtoms('Datenschutz'))->toBe([]);

    m36Approve($outcome->approval, m31Staff('admin'));
    expect(m36RoleAtoms('Datenschutz'))->toBe(['members.export', 'privacy.process', 'privacy.view']);

    expect(fn () => app(SaveRole::class)->handle($admin, null, 'datenschutz', null, []))->toThrow(TeamRefused::class)
        ->and(fn () => app(SaveRole::class)->handle($admin, Role::findByName('support', StaffSeeder::GUARD), 'Hilfe', null, StaffSeeder::ROLES['support']))->toThrow(TeamRefused::class)
        ->and(fn () => app(DeleteRole::class)->handle($admin, Role::findByName('support', StaffSeeder::GUARD), m36Reason()))->toThrow(TeamRefused::class);

    m31Staff('Datenschutz');
    expect(fn () => app(DeleteRole::class)->handle($admin, $role, m36Reason()))->toThrow(TeamRefused::class, __('team.refused.role_in_use', ['role' => 'Datenschutz']));

    $role->users()->each(fn ($staff) => $staff->removeRole($role));
    app(DeleteRole::class)->handle($admin, $role, m36Reason());
    expect(Role::query()->where('name', 'Datenschutz')->exists())->toBeFalse()
        ->and(AuditEvent::query()->where('action', TeamEvent::RoleDeleted->value)->exists())->toBeTrue();
});
