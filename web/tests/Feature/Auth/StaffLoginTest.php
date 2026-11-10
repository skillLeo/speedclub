<?php

use App\Models\Permission;
use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia;
use Laravel\Fortify\Features;

it('configures Fortify for staff only', function () {
    expect(config('fortify.guard'))->toBe('staff')
        ->and(config('fortify.passwords'))->toBe('staff')
        ->and(config('fortify.prefix'))->toBe('admin')
        ->and(config('fortify.views'))->toBeTrue()
        ->and(Features::enabled(Features::registration()))->toBeFalse()
        ->and(Features::enabled(Features::twoFactorAuthentication()))->toBeTrue()
        ->and(Features::enabled(Features::resetPasswords()))->toBeTrue()
        ->and(Features::enabled(Features::updatePasswords()))->toBeTrue()
        ->and(Features::optionEnabled(Features::twoFactorAuthentication(), 'confirm'))->toBeTrue();
});

it('renders ADM-01 through Inertia with the shared props', function () {
    $this->get('/admin/login')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Auth/Login')
            ->where('status', null)
            ->where('staff', null)
            ->where('app.locale', 'de')
            ->where('app.env', 'testing')
            ->has('flash'));
});

it('signs staff in on the staff guard only', function () {
    $staff = Staff::factory()->create(['email' => 'team@speedclub.test']);

    $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
        ->assertRedirect('/admin');

    expect(Auth::guard('staff')->id())->toBe($staff->id)
        ->and(Auth::guard('web')->check())->toBeFalse();
});

it('redirects signed-in staff away from the login page, to enrolment while TOTP is missing', function () {
    $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')
        ->get('/admin/login')
        ->assertRedirect('/admin');

    $this->actingAs(Staff::factory()->create(), 'staff')
        ->get('/admin/login')
        ->assertRedirect('/admin/two-factor/setup');
});

it('rejects wrong staff credentials with a validation error', function () {
    Staff::factory()->create(['email' => 'team@speedclub.test']);

    $this->from('/admin/login')
        ->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'wrong-password'])
        ->assertRedirect('/admin/login')
        ->assertSessionHasErrors('email');

    expect(Auth::guard('staff')->check())->toBeFalse();
});

it('rejects member credentials at the staff login', function () {
    User::factory()->create(['email' => 'member@speedclub.test', 'password' => Hash::make('member-password')]);

    $this->from('/admin/login')
        ->post('/admin/login', ['email' => 'member@speedclub.test', 'password' => 'member-password'])
        ->assertSessionHasErrors('email');

    expect(Auth::guard('staff')->check())->toBeFalse()
        ->and(Auth::guard('web')->check())->toBeFalse();
});

it('rejects suspended staff', function () {
    Staff::factory()->suspended()->create(['email' => 'team@speedclub.test']);

    $this->from('/admin/login')
        ->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
        ->assertSessionHasErrors('email');

    expect(Auth::guard('staff')->check())->toBeFalse();
});

it('rate limits staff logins', function () {
    Staff::factory()->create(['email' => 'team@speedclub.test']);

    foreach (range(1, 5) as $attempt) {
        $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'wrong-password']);
    }

    $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'wrong-password'])
        ->assertTooManyRequests();
});

it('signs staff out', function () {
    $this->actingAs(Staff::factory()->create(), 'staff')
        ->post('/admin/logout')
        ->assertRedirect('/admin/login');

    expect(Auth::guard('staff')->check())->toBeFalse();
});

it('defaults roles and permissions to the staff guard', function () {
    $role = Role::create(['name' => 'support']);
    $permission = Permission::create(['name' => 'members.view']);
    $role->givePermissionTo($permission);

    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $staff->assignRole($role);

    expect($role->guard_name)->toBe('staff')
        ->and($permission->guard_name)->toBe('staff')
        ->and($staff->fresh()->can('members.view'))->toBeTrue();

    $this->actingAs($staff, 'staff')
        ->get('/admin')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('staff.permissions', ['members.view']));
});
