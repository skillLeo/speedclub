<?php

use App\Models\Permission;
use App\Models\Role;
use App\Models\Staff;
use Database\Seeders\StaffSeeder;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * M3.6 follow-up: StaffSeeder on a live host only adds what is missing and never undoes ADM-41/42 edits; a fresh install still gets the
 * full spec table.
 */
beforeEach(function () {
    config(['speedclub.staff.owner_email' => 'owner@example.test']);
});

function staffSeederAtoms(string $role): array
{
    app(PermissionRegistrar::class)->forgetCachedPermissions();

    return Role::findByName($role, StaffSeeder::GUARD)->permissions()->pluck('name')->sort()->values()->all();
}

it('gives a fresh database the spec table and records every pair once', function () {
    $this->seed(StaffSeeder::class);

    foreach (StaffSeeder::specTable() as $role => $atoms) {
        expect(staffSeederAtoms($role))->toBe(collect($atoms)->sort()->values()->all());
    }

    expect(DB::table('staff_seed_grants')->count())->toBe(array_sum(array_map(count(...), StaffSeeder::specTable())));
});

it('keeps an atom an Owner took away and one an Owner added when it runs again', function () {
    $this->seed(StaffSeeder::class);
    Role::findByName('moderator', StaffSeeder::GUARD)->revokePermissionTo('lists.export');
    Role::findByName('analyst', StaffSeeder::GUARD)->givePermissionTo('support.view');

    $this->seed(StaffSeeder::class);

    expect(staffSeederAtoms('moderator'))->not->toContain('lists.export')
        ->and(staffSeederAtoms('analyst'))->toContain('support.view');
});

it('keeps the roles of a seeded account an Owner changed', function () {
    app()->detectEnvironment(fn () => 'local');
    config(['speedclub.demo.staff_password' => 'demo-staff-password']);
    $this->seed(StaffSeeder::class);
    $moderator = Staff::query()->where('email', 'moderator@speedclub.test')->firstOrFail();
    $moderator->syncRoles(['support']);

    $this->seed(StaffSeeder::class);

    expect($moderator->fresh()->roles()->pluck('name')->all())->toBe(['support']);
});

it('grants a new atom once to the roles the spec names, then a removal sticks', function () {
    $this->seed(StaffSeeder::class);
    // An install from before lists.export (ADR-232): the atom and its ledger rows do not exist yet.
    DB::table('staff_seed_grants')->where('permission', 'lists.export')->delete();
    Permission::findByName('lists.export', StaffSeeder::GUARD)->delete();

    $this->seed(StaffSeeder::class);

    foreach (['owner', 'admin', 'moderator', 'support', 'content_editor'] as $role) {
        expect(staffSeederAtoms($role))->toContain('lists.export');
    }
    expect(staffSeederAtoms('analyst'))->not->toContain('lists.export');

    Role::findByName('support', StaffSeeder::GUARD)->revokePermissionTo('lists.export');
    $this->seed(StaffSeeder::class);

    expect(staffSeederAtoms('support'))->not->toContain('lists.export');
});

it('on the first run with the ledger (an install from before it) records what exists and only grants atoms new in this run', function () {
    $this->seed(StaffSeeder::class);
    DB::table('staff_seed_grants')->delete();
    Role::findByName('moderator', StaffSeeder::GUARD)->revokePermissionTo('members.suspend');
    Permission::findByName('lists.export', StaffSeeder::GUARD)->delete();

    $this->seed(StaffSeeder::class);

    expect(staffSeederAtoms('moderator'))->not->toContain('members.suspend')
        ->and(staffSeederAtoms('moderator'))->toContain('lists.export')
        ->and(DB::table('staff_seed_grants')->where(['role' => 'moderator', 'permission' => 'members.suspend'])->exists())->toBeTrue();
});

it('brings back a seeded role that is missing with its spec atoms', function () {
    $this->seed(StaffSeeder::class);
    Role::findByName('analyst', StaffSeeder::GUARD)->delete();

    $this->seed(StaffSeeder::class);

    expect(staffSeederAtoms('analyst'))->toBe(collect(StaffSeeder::ROLES['analyst'])->sort()->values()->all());
});
