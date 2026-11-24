<?php

use App\Http\Middleware\HandleInertiaRequests;
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

it('redirects signed-in staff away from the login page, to enrolment while TOTP is missing in Pflicht mode', function () {
    // ADR-540: enrolment is enforced only while 2FA für Admin-Konten is Pflicht (the Optional default is GovernanceOptionalTest's).
    strictGovernance();

    $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')
        ->get('/admin/login')
        ->assertRedirect('/admin');

    $this->actingAs(Staff::factory()->create(), 'staff')
        ->get('/admin/login')
        ->assertRedirect('/admin/two-factor/setup');
});

it('redirects signed-in staff without TOTP to the admin while 2FA is Optional (ADR-540)', function () {
    publishGovernance(fourEyes: false, staffTwoFactor: 'optional');

    $this->actingAs(Staff::factory()->create(), 'staff')
        ->get('/admin/login')
        ->assertRedirect('/admin');
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

/**
 * Owner bug report 2026-11-16: after signing in the admin sidebar stayed empty until a reload. The page's route list (@routes) is
 * rendered on a full load only and a guest's list holds the sign-in routes alone (SEC-P3-04), so every change of the signed-in state
 * must load the next page fully: Inertia requests get 409 + X-Inertia-Location (Inertia::location), plain posts keep the redirect.
 */
function staffInertiaHeaders(): array
{
    return ['X-Inertia' => 'true', 'X-Inertia-Version' => (string) app(HandleInertiaRequests::class)->version(request()), 'X-Requested-With' => 'XMLHttpRequest'];
}

it('loads the dashboard fully after an Inertia sign-in, so its route list is the staff one', function () {
    Staff::factory()->create(['email' => 'team@speedclub.test']);

    $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'], staffInertiaHeaders())
        ->assertStatus(409)
        ->assertHeader('X-Inertia-Location', '/admin');
});

it('loads the sign-in page fully after an Inertia sign-out, so the staff routes leave the page', function () {
    $this->actingAs(Staff::factory()->create(), 'staff')
        ->post('/admin/logout', [], staffInertiaHeaders())
        ->assertStatus(409)
        ->assertHeader('X-Inertia-Location', '/admin/login');

    expect(Auth::guard('staff')->check())->toBeFalse();
});

it('renders the staff route list on the full load of the dashboard, the guest list on the sign-in page', function () {
    $this->get('/admin/login')->assertOk()->assertSee('"login":{"uri"', false)->assertDontSee('"admin.dashboard":{"uri"', false);

    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $this->actingAs($staff, 'staff')->get('/admin')->assertOk()->assertSee('"admin.dashboard":{"uri"', false);
});
