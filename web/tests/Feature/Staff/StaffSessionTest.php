<?php

use App\Enums\StaffSecurityEvent;
use App\Enums\StaffStatus;
use App\Http\Middleware\EnsureRecentStaffPassword;
use App\Http\Middleware\EnsureStaffActive;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Http\Middleware\RestrictAdminAccess;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Services\Auth\StaffCredentials;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;
use PragmaRX\Google2FA\Google2FA;

require_once __DIR__.'/Helpers.php';

/**
 * M3.1 contract §1.2–§1.4: other sessions end with every credential change and with suspension (SEC-P1-25), the network fence
 * (ADMIN_IP_ALLOWLIST, ADMIN_DOMAIN), the idle rule (ADR-217) and the recent-password middleware (ADR-215).
 */

/** A session that signed in before the credentials changed: it holds the epoch the account had then. */
function m31OldSession(Staff $staff): array
{
    return [StaffCredentials::SESSION_KEY => is_string($staff->credentials_epoch) && $staff->credentials_epoch !== '' ? $staff->credentials_epoch : '-'];
}

/** A test route behind the recent-password middleware, as a sensitive admin write would be. */
function m31SensitiveRoute(): void
{
    Route::middleware(['web', 'staff', 'auth:staff', EnsureStaffTwoFactor::class, 'staff.recent-password'])
        ->post('/admin/__m31/sensitive', function () {
            DB::table('cache')->insert(['key' => 'm31-sensitive-ran', 'value' => '1', 'expiration' => time() + 60]);

            return back(303)->with('success', 'done');
        })->name('admin.m31.sensitive');
}

describe('SEC-P1-25 other staff sessions end', function () {
    it('after a password reset, also inside their password confirmation window', function () {
        $staff = m31Staff(confirmed: false);
        $old = m31OldSession($staff);

        $token = Password::broker('staff')->createToken($staff);
        $this->postJson('/admin/reset-password', ['token' => $token, 'email' => $staff->email, 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])->assertOk();

        // The session from before the reset tries to enrol its own authenticator.
        $this->actingAs($staff->fresh() ?? $staff, 'staff')->withSession([...$old, ...m31ConfirmedPassword()])
            ->postJson('/admin/user/two-factor-authentication')
            ->assertUnauthorized();

        expect($staff->fresh()?->two_factor_secret)->toBeNull()
            ->and(Auth::guard('staff')->check())->toBeFalse()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedCredentialsChanged->value)->count())->toBe(1);
    });

    it('after a password change in another session, which itself goes on', function () {
        $staff = m31Staff('analyst');
        $old = m31OldSession($staff);

        $this->actingAs($staff, 'staff')->withSession([...$old, ...m31ConfirmedPassword()])
            ->putJson('/admin/user/password', ['current_password' => 'password-for-tests', 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertOk();
        $this->get('/admin')->assertOk();

        $this->flushSession();
        $this->actingAs($staff->fresh() ?? $staff, 'staff')->withSession($old)->get('/admin')->assertRedirect('/admin/login');
        expect(session('error'))->toBe(__('staff_auth.session_ended'));
    });

    it('when an enrolment starts or a key is confirmed elsewhere', function () {
        $staff = m31Staff(confirmed: false);
        $old = m31OldSession($staff);

        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        $afterEnable = $staff->fresh()?->credentials_epoch;
        $secret = decrypt((string) $staff->fresh()?->two_factor_secret);
        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => app(Google2FA::class)->getCurrentOtp($secret)])->assertOk();

        expect($afterEnable)->toBeString()->not->toBe($old[StaffCredentials::SESSION_KEY])
            ->and($staff->fresh()?->credentials_epoch)->not->toBe($afterEnable);

        $this->flushSession();
        $this->actingAs($staff->fresh() ?? $staff, 'staff')->withSession($old)->getJson('/admin')->assertUnauthorized();
    });

    it('at once when the account is suspended or deactivated, audited', function (StaffStatus $status) {
        $staff = m31Staff('admin');
        $this->actingAs($staff, 'staff')->get('/admin')->assertOk();

        Staff::query()->whereKey($staff->id)->update(['status' => $status->value]);

        $this->actingAs($staff->fresh() ?? $staff, 'staff')->get('/admin')->assertRedirect('/admin/login');
        expect(Auth::guard('staff')->check())->toBeFalse()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedInactive->value)->where('target_id', (string) $staff->id)->count())->toBe(1);
    })->with([StaffStatus::Suspended, StaffStatus::Deactivated]);

    it('does not finish a sign-in at the challenge after a suspension', function () {
        $staff = m31Staff();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk()->assertJsonPath('two_factor', true);

        Staff::query()->whereKey($staff->id)->update(['status' => StaffStatus::Suspended->value]);

        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt((string) $staff->two_factor_secret))])
            ->assertStatus(422);
        expect(Auth::guard('staff')->check())->toBeFalse();
    });

    it('leaves a session alone whose credentials did not change (control)', function () {
        $staff = m31Staff('analyst');

        $this->actingAs($staff, 'staff')->withSession(m31OldSession($staff))->get('/admin')->assertOk();
        $this->get('/admin')->assertOk();
    });

    it('sits on every staff route, the fence ahead of the session', function () {
        app(Kernel::class);
        $routes = collect(Route::getRoutes()->getRoutes())->filter(fn ($route): bool => in_array('staff', $route->gatherMiddleware(), true));

        expect($routes->count())->toBeGreaterThan(20);

        foreach ($routes as $route) {
            $order = app('router')->gatherRouteMiddleware($route);
            $fence = array_search(RestrictAdminAccess::class, $order, true);

            expect(in_array(EnsureStaffActive::class, $order, true))->toBeTrue($route->uri())
                ->and($fence)->toBeInt($route->uri())
                ->and($fence)->toBeLessThan(array_search(StartSession::class, $order, true), $route->uri());
        }

        expect(app('router')->getMiddleware())->toMatchArray([
            'staff.active' => EnsureStaffActive::class,
            'staff.recent-password' => EnsureRecentStaffPassword::class,
        ]);
    });
});

describe('ADMIN_IP_ALLOWLIST and ADMIN_DOMAIN', function () {
    it('answers 404 to a client outside the allow-list, the sign-in included, and writes no session', function () {
        config(['speedclub.staff.ip_allowlist' => ['10.0.0.0/8', '2001:db8::/32', '192.0.2.7']]);
        config(['session.driver' => 'database']);

        foreach (['/admin/login', '/admin', '/admin/forgot-password'] as $uri) {
            $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])->get($uri)->assertNotFound();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])->postJson('/admin/login', ['email' => 'x@speedclub.test', 'password' => 'x'])->assertNotFound();

        expect(DB::table('sessions')->count())->toBe(0);
    });

    it('lets clients inside the list through, IPv4 and IPv6, CIDR and single address', function (string $ip) {
        config(['speedclub.staff.ip_allowlist' => ['10.0.0.0/8', '2001:db8::/32', '192.0.2.7']]);

        $this->withServerVariables(['REMOTE_ADDR' => $ip])->get('/admin/login')->assertOk();
    })->with(['10.20.30.40', '2001:db8:aaaa::1', '192.0.2.7', '::ffff:10.1.1.1']);

    it('applies to staff who are signed in as well', function () {
        config(['speedclub.staff.ip_allowlist' => ['10.0.0.0/8']]);

        $this->actingAs(m31Staff('owner'), 'staff')->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])->get('/admin')->assertNotFound();
    });

    it('answers only on the admin domain when one is set', function () {
        config(['speedclub.staff.domain' => 'team.speedclub.test']);

        $this->get('http://localhost/admin/login')->assertNotFound();
        $this->get('http://team.speedclub.test/admin/login')->assertOk();
    });

    it('ignores a forged X-Forwarded-For under TRUSTED_PROXIES=* and decides on the connection address (SEC-P3-05)', function () {
        config(['speedclub.staff.ip_allowlist' => ['203.0.113.7'], 'speedclub.trusted_proxies' => ['*']]);

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->withHeader('X-Forwarded-For', '203.0.113.7')->get('/admin/login')->assertNotFound();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->get('/admin/login')->assertOk();
    });

    it('believes X-Forwarded-For only from an explicitly listed proxy (SEC-P3-05)', function () {
        config(['speedclub.staff.ip_allowlist' => ['203.0.113.7'], 'speedclub.trusted_proxies' => ['192.0.2.50']]);

        $this->withServerVariables(['REMOTE_ADDR' => '192.0.2.50'])->withHeader('X-Forwarded-For', '203.0.113.7')->get('/admin/login')->assertOk();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->withHeader('X-Forwarded-For', '203.0.113.7')->get('/admin/login')->assertNotFound();
    });

    it('ignores a forged X-Forwarded-Host for the admin domain under TRUSTED_PROXIES=* (SEC-P3-05)', function () {
        config(['speedclub.staff.domain' => 'team.speedclub.test', 'speedclub.trusted_proxies' => ['*']]);

        $this->withHeader('X-Forwarded-Host', 'team.speedclub.test')->get('http://localhost/admin/login')->assertNotFound();
        $this->get('http://team.speedclub.test/admin/login')->assertOk();
    });

    it('leaves the member side alone (control)', function () {
        config(['speedclub.staff.ip_allowlist' => ['10.0.0.0/8'], 'speedclub.staff.domain' => 'team.speedclub.test']);

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])->getJson('/api/v1/app-config')->assertOk();
    });
});

describe('ADR-217 idle sessions', function () {
    it('keeps the staff session at 30 minutes', function () {
        expect(config('speedclub.staff.session_lifetime'))->toBe(30);
    });

    it('answers the keep-alive with 204 for a signed-in, enrolled session', function () {
        $this->actingAs(m31Staff('analyst'), 'staff')->postJson('/admin/session/keep-alive')->assertNoContent();
    });

    it('sets a marker cookie at sign-in and removes it at sign-out', function () {
        $staff = m31Staff(confirmed: false);

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()
            ->assertCookie(config()->string('speedclub.staff.seen_cookie'));

        $this->postJson('/admin/logout')->assertCookieExpired(config()->string('speedclub.staff.seen_cookie'));
    });

    it('tells a request after the idle limit that the session expired', function () {
        $this->withCookie(config()->string('speedclub.staff.seen_cookie'), '1')
            ->get('/admin')
            ->assertRedirect('/admin/login')
            ->assertSessionHas('session_expired', true);

        $this->get('/admin/login')->assertInertia(fn (AssertableInertia $page) => $page->where('flash.session_expired', true));
    });

    it('shows it on the sign-in page itself when that is the first request', function () {
        $this->withCookie(config()->string('speedclub.staff.seen_cookie'), '1')
            ->get('/admin/login')
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/Login')->where('flash.session_expired', true));
    });

    it('says nothing to a guest who never signed in (control)', function () {
        $this->get('/admin')->assertRedirect('/admin/login')->assertSessionMissing('session_expired');
    });
});

describe('ADR-215 staff.recent-password', function () {
    beforeEach(fn () => m31SensitiveRoute());

    it('refuses a stale confirmation without running the action, and asks for the password', function () {
        $staff = m31Staff('owner');

        $this->actingAs($staff, 'staff')->withSession(['auth.password_confirmed_at' => time() - 301])
            ->from('/admin/audit')
            ->post('/admin/__m31/sensitive')
            ->assertStatus(303)
            ->assertRedirect('/admin/audit')
            ->assertSessionHas('confirm_password', true);

        expect(DB::table('cache')->where('key', 'm31-sensitive-ran')->exists())->toBeFalse();
    });

    it('refuses a session that never confirmed, and a JSON client with 403', function () {
        $this->actingAs(m31Staff('owner'), 'staff')->post('/admin/__m31/sensitive')->assertSessionHas('confirm_password', true);
        $this->actingAs(m31Staff('owner'), 'staff')->postJson('/admin/__m31/sensitive')->assertForbidden()->assertJsonPath('code', 'password_confirmation_required');

        expect(DB::table('cache')->where('key', 'm31-sensitive-ran')->exists())->toBeFalse();
    });

    it('runs the action within five minutes of the confirmation', function () {
        $this->actingAs(m31Staff('owner'), 'staff')->withSession(['auth.password_confirmed_at' => time() - 290])
            ->post('/admin/__m31/sensitive')
            ->assertSessionHas('success', 'done');

        expect(DB::table('cache')->where('key', 'm31-sensitive-ran')->exists())->toBeTrue();
    });
});

describe('authorisation matrix of the server lane routes', function () {
    it('keeps the keep-alive from guests, unenrolled and suspended staff', function () {
        $this->postJson('/admin/session/keep-alive')->assertUnauthorized();
        $this->post('/admin/session/keep-alive')->assertRedirect('/admin/login');

        $this->actingAs(m31Staff(confirmed: false), 'staff')->postJson('/admin/session/keep-alive')->assertStatus(409)->assertJsonPath('code', 'two_factor_required');

        $this->actingAs(m31Staff('admin', attributes: ['status' => StaffStatus::Suspended]), 'staff')->postJson('/admin/session/keep-alive')->assertUnauthorized();
    });

    it('answers the keep-alive for every role', function (string $role) {
        $this->actingAs(m31Staff($role), 'staff')->postJson('/admin/session/keep-alive')->assertNoContent();
    })->with(M31_ROLES);
});
