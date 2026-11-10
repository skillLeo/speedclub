<?php

use App\Enums\ErrorCode;
use App\Enums\StaffSecurityEvent;
use App\Http\Controllers\Admin\Support\AdminLocale;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Http\Middleware\LimitStaffStepInput;
use App\Http\Middleware\RefuseLongQuery;
use App\Http\Responses\Staff\StaffResetLinkRequested;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Auth\TimeboxedPasswordBrokerManager;
use Carbon\CarbonInterval;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Http\Middleware\InvokeDeferredCallbacks;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Session\Store;
use Illuminate\Support\Defer\DeferredCallbackCollection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Sleep;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;
use Laravel\Fortify\Events\TwoFactorAuthenticationEnabled;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

/**
 * Regression tests for the Medium findings of docs/reports/security/phase-1.md about staff access.
 *
 * SEC-P1-01: TOTP is mandatory for staff (06_ADMIN_SPEC §1, ADM-03). Until two_factor_confirmed_at is set, a signed-in staff
 * account reaches only sign-out, enrolment and the password confirmation that enrolment needs.
 * SEC-P1-02: the staff reset steps answer known, unknown and throttled addresses alike, the mail leaves after the response and
 * both steps are limited per IP and per address.
 * SEC-P1-22: once confirmed, TOTP cannot be replaced, removed or read again by a session that shows no current code.
 * SEC-P1-23: a password confirmation lasts five minutes.
 * SEC-P1-24: staff are never remembered: no cookie outlives the 30-minute session.
 * SEC-P1-32: a session that showed no code is ended once the account has confirmed TOTP, and that leaves an audit row.
 * SEC-P1-35: enable and confirm decide on the locked row, not on the model loaded at the start of the request.
 * SEC-P1-37: a remember cookie never replaces the code.
 * SEC-P1-40: a non-string value at a staff step answers 422, and the sign-in limiter counts it.
 * SEC-P1-42: an address up to the input limit answers 422 at the sign-in, because the attempt counter hashes its key.
 * SEC-P1-43: a staff step refuses more than 16 KB of input, ahead of the session and the limiters.
 * SEC-P1-44: a staff request does not collect other people's sessions at its own 30 minutes.
 * SEC-P1-45: a reset token or a code never reaches the session through a failed form.
 * SEC-P1-47: a long URL and the limiter's own answer leave no large anonymous session row, and the sign-in is limited per client.
 */

/** Routes an account without confirmed TOTP still needs. Kept here as well, so the middleware's list cannot grow unnoticed. */
const STAFF_ENROLMENT_ROUTES = [
    'logout',
    'two-factor.enable',
    'two-factor.confirm',
    'two-factor.qr-code',
    'two-factor.secret-key',
    'password.confirm',
    'password.confirm.store',
    'password.confirmation',
    'admin.two-factor.setup',
];

function staffConfirmedPassword(): array
{
    return ['auth.password_confirmed_at' => time()];
}

/** The session started the pending enrolment of this model (SEC-P1-33): EnableStaffTwoFactor keeps this mark. */
function staffStartedEnrolment(Staff $staff): array
{
    return [EnsureStaffTwoFactor::PENDING_SECRET => EnsureStaffTwoFactor::secretFingerprint($staff)];
}

/** The owner confirms TOTP in another browser: only the row changes, as a second session would change it. Returns the secret. */
function staffConfirmsTotpElsewhere(Staff $staff): string
{
    $secret = app(Google2FA::class)->generateSecretKey();

    Staff::query()->whereKey($staff->getKey())->sole()->forceFill([
        'two_factor_secret' => encrypt($secret),
        'two_factor_recovery_codes' => encrypt((string) json_encode(['aaaaaaaaaa-bbbbbbbbbb'])),
        'two_factor_confirmed_at' => now(),
    ])->save();

    return $secret;
}

/** A new request, not the guard's memory of the last one. */
function nextStaffRequest(): void
{
    app('auth')->forgetGuards();
}

/**
 * Tests run on the array cache, which has no key length, so SEC-P1-42 could not fail there. Keeps the limiter instance, it holds the
 * named limiters: only its store changes, to the one the app uses outside tests.
 */
function staffLimiterOnDatabaseCache(): void
{
    $store = Cache::store('database');
    (function () use ($store): void {
        $this->cache = $store;
    })->call(app(RateLimiter::class));
    DB::table('cache')->delete();
}

function staffSessionBytes(): int
{
    return strlen((string) json_encode(session()->all()));
}

/** Tests run on the array session driver, which writes no row (SEC-P1-43). */
function staffSessionsOnDatabase(): void
{
    config(['session.driver' => 'database']);
    app('session')->forgetDrivers();
    app()->forgetInstance('session.store');
}

function staffSessionRowBytes(): int
{
    return (int) DB::table('sessions')->sum(DB::raw('LENGTH(payload)'));
}

/**
 * @param  array<string, mixed>  $data
 */
function statefulApiSessionRow(array $data = []): string
{
    $id = Str::random(40);
    $payload = ['_token' => Str::random(40), ...$data];

    DB::table('sessions')->insert([
        'id' => $id,
        'user_id' => null,
        'ip_address' => null,
        'user_agent' => 'x',
        'payload' => base64_encode(config()->string('session.serialization', 'php') === 'json' ? (string) json_encode($payload) : serialize($payload)),
        'last_activity' => now()->subMinute()->getTimestamp(),
    ]);

    return $id;
}

function statefulApiBrowser(string $sessionId): TestCase
{
    return test()->withCredentials()->withHeader('Referer', 'http://localhost:8080/app')->withCookie(config()->string('session.cookie'), $sessionId);
}

/**
 * A real database session signed in on the staff guard: only the cookie carries it, and invalidating it has a row to remove.
 */
function staffDatabaseSession(Staff $staff, bool $marked): string
{
    $id = databaseSessionFor($staff, 'staff');

    if ($marked) {
        $store = new Store('test', app('session')->driver('database')->getHandler(), $id, config()->string('session.serialization', 'php'));
        $store->start();
        $store->put(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE, true);
        $store->save();
    }

    return $id;
}

/**
 * @return array{string, string} name and value of a remember cookie that the guard accepts
 */
function staffRecallerCookie(Staff $staff): array
{
    $staff->forceFill(['remember_token' => str_repeat('r', 60)])->save();

    return [Auth::guard('staff')->getRecallerName(), $staff->id.'|'.$staff->remember_token.'|'.$staff->password];
}

/**
 * Counts the row locks taken on the staff table from now on.
 *
 * @return Closure(): int
 */
function staffRowLocks(): Closure
{
    $locks = 0;
    DB::listen(function (QueryExecuted $query) use (&$locks): void {
        if (str_contains($query->sql, 'from `staff`') && str_contains($query->sql, 'for update')) {
            $locks++;
        }
    });

    return function () use (&$locks): int {
        return $locks;
    };
}

/**
 * Twice the framework's 200 ms: at the production cost one argon2id hash alone takes about that long (SEC-P1-19), so a floor
 * below this leaves no headroom. StaffResetTimingTest (group perf) measures the real gap.
 */
const STAFF_RESET_MIN_FLOOR_MS = 400.0;

/**
 * Wall time of one request plus what the broker's timebox slept, with the sleep faked so the suite does not wait.
 *
 * @param  Closure(): mixed  $request
 * @return array{ms: float, sleeps: int}
 */
function staffResetRequestTime(Closure $request): array
{
    $slept = [];
    Sleep::fake();
    Sleep::whenFakingSleep(function (CarbonInterval $duration) use (&$slept): void {
        $slept[] = $duration->totalMicroseconds / 1000;
    });

    $start = hrtime(true);
    $request();
    $ms = (hrtime(true) - $start) / 1e6;

    return ['ms' => $ms + array_sum($slept), 'sleeps' => count($slept)];
}

describe('SEC-P1-01 staff TOTP enrolment', function () {
    it('keeps staff without two-factor out of the dashboard', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->get('/admin')
            ->assertRedirect('/admin/two-factor/setup');
    });

    it('answers 409 with the error shape to a JSON client', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->getJson('/admin')
            ->assertStatus(409)
            ->assertExactJson([
                'message' => __('errors.two_factor_required'),
                'code' => 'two_factor_required',
                'errors' => [],
                'enrolment_url' => url('/admin/two-factor/setup'),
            ]);
    });

    it('treats an enabled but unconfirmed secret as not enrolled', function () {
        $staff = Staff::factory()->create([
            'two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey()),
            'two_factor_confirmed_at' => null,
        ]);

        $this->actingAs($staff, 'staff')->getJson('/admin')->assertStatus(409);
    });

    it('lets staff with confirmed two-factor reach the dashboard', function () {
        $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')
            ->get('/admin')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Dashboard/Index'));
    });

    it('blocks every other staff step until enrolment', function (string $method, string $uri) {
        $staff = Staff::factory()->create();
        $before = $staff->password;

        $this->actingAs($staff, 'staff')
            ->withSession(staffConfirmedPassword())
            ->json($method, $uri, [
                'current_password' => 'password-for-tests',
                'password' => 'a-new-staff-password-1',
                'password_confirmation' => 'a-new-staff-password-1',
            ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'two_factor_required');

        expect($staff->fresh()->password)->toBe($before);
    })->with([
        'password change' => ['PUT', '/admin/user/password'],
        'recovery codes' => ['GET', '/admin/user/two-factor-recovery-codes'],
        'new recovery codes' => ['POST', '/admin/user/two-factor-recovery-codes'],
        'disable two-factor' => ['DELETE', '/admin/user/two-factor-authentication'],
    ]);

    it('still lets an account without two-factor sign out', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->post('/admin/logout')
            ->assertRedirect('/admin/login');
    });

    it('still lets an account without two-factor confirm its password', function () {
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')
            ->getJson('/admin/user/confirmed-password-status')
            ->assertOk();

        $this->actingAs($staff, 'staff')
            ->postJson('/admin/user/confirm-password', ['password' => 'password-for-tests'])
            ->assertCreated();
    });

    it('lets an account enrol and then reach the dashboard', function () {
        $staff = Staff::factory()->create();
        $session = staffConfirmedPassword();

        $this->actingAs($staff, 'staff')->withSession($session)->postJson('/admin/user/two-factor-authentication')->assertOk();
        $this->actingAs($staff, 'staff')->withSession($session)->getJson('/admin/user/two-factor-qr-code')->assertOk()->assertJsonStructure(['svg', 'url']);
        $this->actingAs($staff, 'staff')->withSession($session)->getJson('/admin/user/two-factor-secret-key')->assertOk()->assertJsonStructure(['secretKey']);
        $this->actingAs($staff, 'staff')->getJson('/admin')->assertStatus(409);

        $code = app(Google2FA::class)->getCurrentOtp(decrypt($staff->fresh()->two_factor_secret));

        $this->actingAs($staff->fresh(), 'staff')->withSession($session)
            ->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => $code])
            ->assertOk();

        expect($staff->fresh()->two_factor_confirmed_at)->not->toBeNull();

        $this->actingAs($staff->fresh(), 'staff')->get('/admin')->assertOk();
        $this->actingAs($staff->fresh(), 'staff')->withSession($session)->getJson('/admin/user/two-factor-recovery-codes')->assertOk();
    });

    it('signs an account without two-factor in, but straight into enrolment', function () {
        Staff::factory()->create(['email' => 'team@speedclub.test']);

        $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
            ->assertRedirect('/admin');

        $this->get('/admin')->assertRedirect('/admin/two-factor/setup');
    });

    it('redirects a form write with 303 for Inertia', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->put('/admin/user/password', [])
            ->assertStatus(303)
            ->assertRedirect('/admin/two-factor/setup');
    });

    it('leaves guests and members to the staff guard', function () {
        $this->get('/admin')->assertRedirect('/admin/login');
        $this->getJson('/admin/user/two-factor-qr-code')->assertUnauthorized();
    });

    it('covers every signed-in staff route apart from the enrolment steps', function () {
        $missing = [];
        $checked = 0;

        foreach (Route::getRoutes()->getRoutes() as $route) {
            /** @var LaravelRoute $route */
            $middleware = array_filter($route->gatherMiddleware(), is_string(...));

            if (! in_array('auth:staff', $middleware, true) || in_array($route->getName(), STAFF_ENROLMENT_ROUTES, true)) {
                continue;
            }

            $checked++;

            if (! in_array(EnsureStaffTwoFactor::class, $middleware, true)) {
                $missing[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        expect($checked)->toBeGreaterThan(4)
            ->and($missing)->toBe([])
            ->and(EnsureStaffTwoFactor::ENROLMENT_ROUTES)->toEqualCanonicalizing(STAFF_ENROLMENT_ROUTES)
            ->and(collect(EnsureStaffTwoFactor::CLOSED_ONCE_CONFIRMED)->reject(fn (string $name): bool => Route::has($name))->all())->toBe([]);
    });
});

describe('SEC-P1-32 a session that signed in without a code', function () {
    it('is ended once TOTP is confirmed elsewhere', function () {
        $staff = Staff::factory()->create();

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()->assertJson(['two_factor' => false]);
        nextStaffRequest();
        $this->getJson('/admin')->assertStatus(409);

        staffConfirmsTotpElsewhere($staff);
        nextStaffRequest();

        $this->getJson('/admin')
            ->assertUnauthorized()
            ->assertExactJson(['message' => ErrorCode::Unauthenticated->message(), 'code' => 'unauthenticated', 'errors' => []]);

        expect(session()->has(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeFalse()
            ->and(Auth::guard('staff')->hasUser())->toBeFalse();

        $event = AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->sole();

        expect($event->actor_id)->toBe((string) $staff->id)
            ->and($event->target_id)->toBe((string) $staff->id);

        // It stays signed out: the guard's answer now, no longer the fence's.
        nextStaffRequest();
        $this->getJson('/admin')->assertUnauthorized();
        $this->get('/admin')->assertRedirect('/admin/login');
    });

    it('writes the audit row before it signs out', function () {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        staffConfirmsTotpElsewhere($staff);
        nextStaffRequest();
        $rowsAtLogout = null;
        Event::listen(Logout::class, function () use (&$rowsAtLogout): void {
            $rowsAtLogout = AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->count();
        });

        $this->getJson('/admin')->assertUnauthorized();

        expect($rowsAtLogout)->toBe(1);
    });

    it('sends the browser back to the sign-in, with 303 after a write for Inertia', function (string $method, int $status) {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        staffConfirmsTotpElsewhere($staff);
        nextStaffRequest();

        $this->call($method, $method === 'GET' ? '/admin' : '/admin/user/password')
            ->assertStatus($status)
            ->assertRedirect('/admin/login');
    })->with([
        'read' => ['GET', 302],
        'write' => ['PUT', 303],
    ]);

    it('reaches no step past the sign-in, not even with the password just confirmed', function (string $method, string $uri) {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        $secret = staffConfirmsTotpElsewhere($staff);
        $before = $staff->fresh()->only(['password', 'two_factor_secret', 'two_factor_recovery_codes']);
        nextStaffRequest();

        $this->withSession(staffConfirmedPassword())
            ->json($method, $uri, [
                'password' => 'password-for-tests',
                'current_password' => 'password-for-tests',
                'password_confirmation' => 'password-for-tests',
                'code' => app(Google2FA::class)->getCurrentOtp($secret),
            ])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthenticated')
            ->assertJsonMissingPath('0');

        expect($staff->fresh()->only(['password', 'two_factor_secret', 'two_factor_recovery_codes']))->toBe($before);
    })->with([
        'password change' => ['PUT', '/admin/user/password'],
        'recovery codes' => ['GET', '/admin/user/two-factor-recovery-codes'],
        'new recovery codes' => ['POST', '/admin/user/two-factor-recovery-codes'],
        'password confirmation' => ['POST', '/admin/user/confirm-password'],
        'confirming TOTP with a stolen code' => ['POST', '/admin/user/confirmed-two-factor-authentication'],
        'enable' => ['POST', '/admin/user/two-factor-authentication'],
        'disable' => ['DELETE', '/admin/user/two-factor-authentication'],
        'secret key' => ['GET', '/admin/user/two-factor-secret-key'],
    ]);

    it('is ended even when TOTP was confirmed between the two password checks of one sign-in', function () {
        $staff = Staff::factory()->create();
        $authenticate = Fortify::$authenticateUsingCallback;
        $calls = 0;

        // Fortify's pipeline runs the callback twice: the first decides on the challenge, the second signs in.
        Fortify::authenticateUsing(function (Request $request) use ($authenticate, $staff, &$calls): ?Staff {
            if (++$calls === 2) {
                staffConfirmsTotpElsewhere($staff);
            }

            return $authenticate($request);
        });

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()->assertJson(['two_factor' => false]);

        expect($calls)->toBe(2)->and($staff->fresh()->hasEnabledTwoFactorAuthentication())->toBeTrue();

        nextStaffRequest();
        $this->getJson('/admin')->assertUnauthorized();
    });

    it('has to go through the challenge to come back', function () {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        $secret = staffConfirmsTotpElsewhere($staff);
        nextStaffRequest();
        $this->getJson('/admin')->assertUnauthorized();

        nextStaffRequest();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()->assertJson(['two_factor' => true]);
        $this->getJson('/admin')->assertUnauthorized();

        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp($secret)])->assertNoContent();
        nextStaffRequest();
        $this->getJson('/admin')->assertOk();
    });

    it('stays signed in when it confirmed TOTP itself (control)', function () {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        expect(session(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeTrue();
        nextStaffRequest();
        $this->withSession(staffConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        nextStaffRequest();
        $code = app(Google2FA::class)->getCurrentOtp(decrypt($staff->fresh()->two_factor_secret));

        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => $code])->assertOk();

        expect(session()->has(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeFalse();
        nextStaffRequest();
        $this->getJson('/admin')->assertOk();

        expect(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->exists())->toBeFalse();
    });

    it('stays signed in when a wrong code changed nothing, and is still ended afterwards (control)', function () {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        nextStaffRequest();
        $this->withSession(staffConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        nextStaffRequest();

        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => '000000'])->assertUnprocessable();

        expect(session(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeTrue();

        staffConfirmsTotpElsewhere($staff);
        nextStaffRequest();
        $this->getJson('/admin')->assertUnauthorized();
    });

    it('does not mark a session through the challenge (control)', function (string $proof) {
        $staff = Staff::factory()->create();
        $secret = staffConfirmsTotpElsewhere($staff);
        $body = $proof === 'code'
            ? ['code' => app(Google2FA::class)->getCurrentOtp($secret)]
            : ['recovery_code' => $staff->fresh()->recoveryCodes()[0]];

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk()->assertJson(['two_factor' => true]);
        $this->postJson('/admin/two-factor-challenge', $body)->assertNoContent();

        expect(session()->has(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeFalse();
        nextStaffRequest();
        $this->getJson('/admin')->assertOk();
    })->with(['code', 'recovery code']);

    it('clears an old mark when the same session shows a code at the challenge', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->withSession([EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE => true])
            ->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()->assertJson(['two_factor' => true]);
        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt($staff->two_factor_secret))])
            ->assertNoContent();

        nextStaffRequest();
        $this->getJson('/admin')->assertOk();
    });

    it('leaves a failed code at the challenge without a sign-in', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk()->assertJson(['two_factor' => true]);
        $this->postJson('/admin/two-factor-challenge', ['code' => '000000'])->assertUnprocessable();

        nextStaffRequest();
        $this->getJson('/admin')->assertUnauthorized();
    });

    it('removes the stored session and leaves the old cookie dead', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        $id = staffDatabaseSession($staff, marked: true);

        $this->withCredentials()->withCookie('sc_staff_session', $id)->getJson('/admin')->assertUnauthorized();

        expect(DB::table('sessions')->where('id', $id)->doesntExist())->toBeTrue()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->count())->toBe(1);

        nextStaffRequest();
        $this->withCredentials()->withCookie('sc_staff_session', $id)->getJson('/admin')->assertUnauthorized();

        // The guard's answer this time: the fence has nothing left to end.
        expect(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->count())->toBe(1);
    });

    it('keeps a stored session without the mark (control)', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        $id = staffDatabaseSession($staff, marked: false);

        $this->withCredentials()->withCookie('sc_staff_session', $id)->getJson('/admin')->assertOk();

        expect(DB::table('sessions')->where('id', $id)->exists())->toBeTrue()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->count())->toBe(0);
    });
});

describe('SEC-P1-22 confirmed staff TOTP cannot be replaced, removed or copied', function () {
    it('refuses a forced re-enable, and the owner keeps signing in with the old code', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create(['email' => 'team@speedclub.test']);
        $secret = $staff->two_factor_secret;
        $codes = $staff->two_factor_recovery_codes;

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication', ['force' => true])
            ->assertForbidden()
            ->assertExactJson(['message' => ErrorCode::Forbidden->message(), 'code' => 'forbidden', 'errors' => []]);

        $after = $staff->fresh();

        expect($after->two_factor_secret)->toBe($secret)
            ->and($after->two_factor_recovery_codes)->toBe($codes)
            ->and($after->two_factor_confirmed_at)->not->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0);

        Auth::guard('staff')->logout();
        app()->forgetInstance('auth.driver');

        $this->postJson('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
            ->assertOk()
            ->assertJson(['two_factor' => true]);
        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt($secret))])
            ->assertNoContent();
    });

    it('closes every step that would replace, remove or copy it, before any password check', function (string $method, string $uri, array $session) {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        $secret = $staff->two_factor_secret;
        $codes = $staff->two_factor_recovery_codes;

        $this->actingAs($staff, 'staff')->withSession($session)
            ->json($method, $uri)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden')
            ->assertJsonMissingPath('secretKey')
            ->assertJsonMissingPath('svg');

        $after = $staff->fresh();

        expect($after->two_factor_secret)->toBe($secret)
            ->and($after->two_factor_recovery_codes)->toBe($codes)
            ->and($after->two_factor_confirmed_at)->not->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0);
    })->with([
        'enable' => ['POST', '/admin/user/two-factor-authentication'],
        'disable' => ['DELETE', '/admin/user/two-factor-authentication'],
        'secret key' => ['GET', '/admin/user/two-factor-secret-key'],
        'QR code' => ['GET', '/admin/user/two-factor-qr-code'],
    ])->with([
        'password just confirmed' => [fn () => staffConfirmedPassword()],
        'password not confirmed' => [fn () => []],
    ]);

    it('refuses the browser form as well', function (string $method, string $uri) {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        $secret = $staff->two_factor_secret;

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->call($method, $uri, ['force' => true])
            ->assertForbidden();

        expect($staff->fresh()->two_factor_secret)->toBe($secret);
    })->with([
        'enable' => ['POST', '/admin/user/two-factor-authentication'],
        'disable' => ['DELETE', '/admin/user/two-factor-authentication'],
    ]);

    it('still challenges a password-only sign-in after a refused forced enable', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create(['email' => 'team@speedclub.test']);

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication', ['force' => true]);

        Auth::guard('staff')->logout();
        app()->forgetInstance('auth.driver');

        $this->postJson('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
            ->assertOk()
            ->assertJson(['two_factor' => true]);
    });

    it('leaves a confirmed account every other step, but not Fortify\'s recovery codes (SEC-P1-36: ADM-51 asks for a code)', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->getJson('/admin/user/two-factor-recovery-codes')
            ->assertForbidden();
        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-recovery-codes')
            ->assertForbidden();
        expect($staff->fresh()->two_factor_recovery_codes)->toBe($staff->two_factor_recovery_codes);
        $this->actingAs($staff, 'staff')->get('/admin')->assertOk();
    });

    it('never replaces confirmed TOTP in the action either, should another caller reach it', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        $secret = $staff->two_factor_secret;

        app(EnableTwoFactorAuthentication::class)($staff, true);

        expect($staff->fresh()->two_factor_secret)->toBe($secret)
            ->and($staff->fresh()->two_factor_confirmed_at)->not->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0);
    });

    it('still lets an account without TOTP enrol (control for the closed steps)', function () {
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        $this->actingAs($staff->fresh(), 'staff')->withSession(staffConfirmedPassword())->getJson('/admin/user/two-factor-secret-key')->assertOk();
        $this->actingAs($staff->fresh(), 'staff')->withSession(staffConfirmedPassword())->getJson('/admin/user/two-factor-qr-code')->assertOk();
    });

    it('lets an unfinished enrolment start over with a new secret, unconfirmed and audited', function () {
        $staff = Staff::factory()->create([
            'two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey()),
            'two_factor_confirmed_at' => null,
        ]);
        $pending = $staff->two_factor_secret;

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication', ['force' => true])
            ->assertOk();

        expect($staff->fresh()->two_factor_secret)->not->toBe($pending)
            ->and($staff->fresh()->two_factor_confirmed_at)->toBeNull()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorEnabled->value)->count())->toBe(1);
    });

    it('keeps an unfinished enrolment behind the password confirmation', function () {
        $staff = Staff::factory()->create([
            'two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey()),
            'two_factor_confirmed_at' => null,
        ]);
        $pending = $staff->two_factor_secret;

        $this->actingAs($staff, 'staff')
            ->postJson('/admin/user/two-factor-authentication', ['force' => true])
            ->assertStatus(423);

        expect($staff->fresh()->two_factor_secret)->toBe($pending);
    });

    it('audits enrolment, confirmation and the one read of the recovery codes, without any secret', function () {
        $staff = Staff::factory()->create();
        $session = staffConfirmedPassword();

        $this->actingAs($staff, 'staff')->withSession($session)->postJson('/admin/user/two-factor-authentication')->assertOk();
        $secret = decrypt($staff->fresh()->two_factor_secret);
        $this->actingAs($staff->fresh(), 'staff')->withSession($session)
            ->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => app(Google2FA::class)->getCurrentOtp($secret)])
            ->assertOk();
        $this->actingAs($staff->fresh(), 'staff')->withSession($session)->getJson('/admin/user/two-factor-recovery-codes')->assertOk();
        // Once only (SEC-P1-36): later reads and new codes go through ADM-51 with a current code.
        $this->actingAs($staff->fresh(), 'staff')->withSession($session)->getJson('/admin/user/two-factor-recovery-codes')->assertForbidden();
        $this->actingAs($staff->fresh(), 'staff')->withSession($session)->postJson('/admin/user/two-factor-recovery-codes')->assertForbidden();

        $events = AuditEvent::query()->orderBy('id')->get();

        expect($events->pluck('action')->all())->toBe([
            StaffSecurityEvent::TwoFactorEnabled->value,
            StaffSecurityEvent::TwoFactorConfirmed->value,
            StaffSecurityEvent::RecoveryCodesViewed->value,
        ])
            ->and($events->pluck('actor_id')->unique()->all())->toBe([(string) $staff->id])
            ->and(json_encode($events->map->only(['before', 'after', 'reason'])))->not->toContain($secret);
    });

    it('audits Fortify\'s disable event for staff, for when ADM-51 opens that step again', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        TwoFactorAuthenticationDisabled::dispatch($staff);

        $event = AuditEvent::query()->sole();

        expect($event->action)->toBe(StaffSecurityEvent::TwoFactorDisabled->value)
            ->and($event->actor_id)->toBe((string) $staff->id)
            ->and($event->target_id)->toBe((string) $staff->id);
    });

    it('audits sign-in with a recovery code, without the code', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create(['email' => 'team@speedclub.test']);
        $code = $staff->recoveryCodes()[0];

        // JSON: views=false, so the challenge page is not a Fortify route.
        $this->postJson('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])->assertOk()->assertJson(['two_factor' => true]);
        $this->postJson('/admin/two-factor-challenge', ['recovery_code' => $code])->assertNoContent();

        $event = AuditEvent::query()->where('action', StaffSecurityEvent::RecoveryCodeUsed->value)->sole();

        expect($event->target_id)->toBe((string) $staff->id)
            ->and(json_encode([$event->before, $event->after, $event->reason]))->not->toContain($code);
    });
});

describe('SEC-P1-02 staff password reset', function () {
    it('answers known, unknown and already-asked addresses the same', function () {
        Notification::fake();
        Staff::factory()->create(['email' => 'owner@speedclub.test']);

        $answers = collect(['nobody@speedclub.test', 'owner@speedclub.test', 'owner@speedclub.test', 'OWNER@speedclub.test'])
            ->map(fn (string $email) => $this->postJson('/admin/forgot-password', ['email' => $email]))
            ->map(fn ($response) => [$response->status(), $response->json()]);

        expect($answers->unique()->values()->all())->toBe([[200, ['message' => StaffResetLinkRequested::message()]]])
            ->and(StaffResetLinkRequested::message())->toContain('60');
        Notification::assertSentTimes(ResetPassword::class, 1);
    });

    it('names the validity of the link in the right plural form, in German and English', function (int $minutes, string $de, string $en) {
        config(['auth.passwords.staff.expire' => $minutes]);

        expect(StaffResetLinkRequested::message())->toEndWith($de);

        app()->setLocale('en');

        expect(StaffResetLinkRequested::message())->toEndWith($en);
    })->with([
        'one' => [1, 'Er gilt 1 Minute.', 'It is valid for 1 minute.'],
        'many' => [60, 'Er gilt 60 Minuten.', 'It is valid for 60 minutes.'],
    ]);

    it('answers the Inertia form the same for known and unknown addresses', function () {
        Notification::fake();
        Staff::factory()->create(['email' => 'owner@speedclub.test']);

        foreach (['nobody@speedclub.test', 'owner@speedclub.test'] as $email) {
            $this->from('/admin/forgot-password')
                ->post('/admin/forgot-password', ['email' => $email])
                ->assertRedirect('/admin/forgot-password')
                ->assertSessionHasNoErrors()
                ->assertSessionHas('status', StaffResetLinkRequested::message());
        }
    });

    it('sends the reset mail only after the response', function () {
        Notification::fake();
        $staff = Staff::factory()->create();

        $this->withoutMiddleware(InvokeDeferredCallbacks::class)
            ->postJson('/admin/forgot-password', ['email' => $staff->email])
            ->assertOk();

        Notification::assertNothingSent();

        app(DeferredCallbackCollection::class)->invoke();

        Notification::assertSentTo($staff, ResetPassword::class);
    });

    it('pads every reset-link outcome to the same floor, above one hash of a new token', function () {
        Notification::fake();
        $staff = Staff::factory()->create();

        $totals = collect([
            'known' => $staff->email,
            'unknown' => 'nobody@speedclub.test',
            'already asked' => $staff->email,
        ])->map(fn (string $email): array => staffResetRequestTime(
            fn () => $this->postJson('/admin/forgot-password', ['email' => $email])->assertOk(),
        ));

        // Each outcome slept once, so its work stayed below the floor, and each lasted the floor.
        expect($totals->pluck('sleeps')->unique()->all())->toBe([1])
            ->and($totals->pluck('ms')->min())->toBeGreaterThanOrEqual(STAFF_RESET_MIN_FLOOR_MS);
        Notification::assertSentTimes(ResetPassword::class, 1);
    });

    it('pads a wrong token for a known address and an unknown address to the same floor', function () {
        $staff = Staff::factory()->create(['email' => 'owner@speedclub.test']);
        // A real token row, so the wrong token goes through the hash check of DatabaseTokenRepository::exists().
        Password::broker('staff')->createToken($staff);
        $body = fn (string $email): array => ['email' => $email, 'token' => str_repeat('a', 64), 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'];

        $totals = collect(['owner@speedclub.test', 'nobody@speedclub.test'])->map(fn (string $email): array => staffResetRequestTime(
            fn () => $this->postJson('/admin/reset-password', $body($email))->assertUnprocessable(),
        ));

        expect($totals->pluck('sleeps')->unique()->all())->toBe([1])
            ->and($totals->pluck('ms')->min())->toBeGreaterThanOrEqual(STAFF_RESET_MIN_FLOOR_MS);
    });

    it('keeps the timebox of the member broker at the framework default', function () {
        expect(TimeboxedPasswordBrokerManager::timebox('users'))->toBe(config()->integer('auth.timebox_duration', 200000))
            ->and(TimeboxedPasswordBrokerManager::timebox('staff'))->toBe(config()->integer('auth.passwords.staff.timebox'))
            ->and(app('auth.password'))->toBeInstanceOf(TimeboxedPasswordBrokerManager::class);
    });

    it('answers a wrong token the same for known and unknown addresses', function () {
        Staff::factory()->create(['email' => 'owner@speedclub.test']);

        $answers = collect(['nobody@speedclub.test', 'owner@speedclub.test'])
            ->map(fn (string $email) => $this->postJson('/admin/reset-password', [
                'email' => $email,
                'token' => str_repeat('a', 64),
                'password' => 'a-new-staff-password-1',
                'password_confirmation' => 'a-new-staff-password-1',
            ]))
            ->map(fn ($response) => [$response->status(), $response->json('errors')]);

        expect($answers->unique()->values()->all())->toBe([[422, ['email' => [__('staff_auth.reset_failed')]]]]);
    });

    it('answers a wrong token the same to the form for known and unknown addresses', function () {
        Sleep::fake();
        Staff::factory()->create(['email' => 'owner@speedclub.test']);

        foreach (['nobody@speedclub.test', 'owner@speedclub.test'] as $email) {
            $response = $this->from('/admin/reset')->post('/admin/reset-password', [
                'email' => $email,
                'token' => str_repeat('a', 64),
                'password' => 'a-new-staff-password-1',
                'password_confirmation' => 'a-new-staff-password-1',
            ]);

            $response->assertRedirect('/admin/reset')
                ->assertSessionHasErrors(['email' => __('staff_auth.reset_failed')]);

            expect(session('_old_input'))->toBe(['email' => $email]);
        }
    });

    it('limits reset links per IP without telling', function () {
        Notification::fake();
        $staff = Staff::factory()->create();
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');

        foreach (range(1, $max) as $i) {
            $this->postJson('/admin/forgot-password', ['email' => "nobody$i@speedclub.test"])->assertOk();
        }

        $this->postJson('/admin/forgot-password', ['email' => $staff->email])
            ->assertOk()
            ->assertExactJson(['message' => StaffResetLinkRequested::message()]);

        Notification::assertNothingSent();

        $this->withServerVariables(['REMOTE_ADDR' => '10.20.30.40'])
            ->postJson('/admin/forgot-password', ['email' => $staff->email])
            ->assertOk();

        Notification::assertSentTimes(ResetPassword::class, 1);
    });

    it('limits reset links per address across IPs, counting the links really sent (SEC-P1-21)', function () {
        Notification::fake();
        $staff = Staff::factory()->create();
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');

        // Each past the broker's own 60 seconds per address, so each request sends a link.
        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])
                ->postJson('/admin/forgot-password', ['email' => $staff->email])
                ->assertOk();
            $this->travel(2)->minutes();
        }

        Notification::assertSentTimes(ResetPassword::class, $max);

        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.1'])
            ->postJson('/admin/forgot-password', ['email' => strtoupper($staff->email)])
            ->assertOk()
            ->assertExactJson(['message' => StaffResetLinkRequested::message()]);

        Notification::assertSentTimes(ResetPassword::class, $max);
    });

    it('keys the limiter safely when the address is not a string', function () {
        $this->postJson('/admin/forgot-password', ['email' => ['owner@speedclub.test']])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    });

    it('limits new-password attempts', function () {
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');
        $body = ['email' => 'nobody@speedclub.test', 'token' => 'wrong', 'password' => 'x', 'password_confirmation' => 'x'];

        foreach (range(1, $max) as $i) {
            $this->postJson('/admin/reset-password', $body)->assertUnprocessable();
        }

        $this->postJson('/admin/reset-password', $body)
            ->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After');
    });

    it('limits new-password attempts per address across IPs', function () {
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');
        $body = ['email' => 'owner@speedclub.test', 'token' => 'wrong', 'password' => 'x', 'password_confirmation' => 'x'];

        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])->postJson('/admin/reset-password', $body)->assertUnprocessable();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.0.1.1'])->postJson('/admin/reset-password', $body)->assertTooManyRequests();
    });

    it('answers the form at the new-password limiter, keeping only the address', function () {
        Sleep::fake();
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');
        $body = [
            'email' => 'owner@speedclub.test',
            'token' => str_repeat('a', 64),
            'password' => 'a-new-staff-password-1',
            'password_confirmation' => 'a-new-staff-password-1',
        ];

        foreach (range(1, $max) as $i) {
            $this->from('/admin/reset')->post('/admin/reset-password', $body)->assertRedirect('/admin/reset');
        }

        $this->from('/admin/reset')->post('/admin/reset-password', $body)
            ->assertRedirect('/admin/reset')
            ->assertSessionHasErrors('email');

        expect(session('errors')->first('email'))->toStartWith(Str::before(__('rate_limits.staff_password_reset'), ':time'))
            ->and(session('_old_input'))->toBeNull();
    });
});

describe('SEC-P1-23 re-authentication window (06_ADMIN_SPEC §1: 5 minutes)', function () {
    it('asks for the password again once the confirmation is older than five minutes', function () {
        $staff = Staff::factory()->create([
            'two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey()),
            'two_factor_confirmed_at' => null,
        ]);
        $pending = $staff->two_factor_secret;

        $this->actingAs($staff, 'staff')->withSession(['auth.password_confirmed_at' => time() - 301])
            ->postJson('/admin/user/two-factor-authentication', ['force' => true])
            ->assertStatus(423);

        expect($staff->fresh()->two_factor_secret)->toBe($pending);
    });

    it('accepts a confirmation inside the window (control for the fix)', function () {
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')->withSession(['auth.password_confirmed_at' => time() - 240])
            ->postJson('/admin/user/two-factor-authentication')
            ->assertOk();
    });
});

describe('SEC-P1-24 staff remember cookie', function () {
    it('is not set by a sign-in without TOTP', function () {
        $staff = Staff::factory()->create(['email' => 'team@speedclub.test']);

        $this->postJson('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests', 'remember' => true])
            ->assertOk()
            ->assertCookieMissing(Auth::guard('staff')->getRecallerName());

        expect($staff->fresh()->remember_token)->toBeNull();
    });

    it('is not set by the browser form', function () {
        Staff::factory()->create(['email' => 'team@speedclub.test']);

        $this->post('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests', 'remember' => 'on'])
            ->assertRedirect('/admin')
            ->assertCookieMissing(Auth::guard('staff')->getRecallerName());
    });

    it('is not set through the query string either', function () {
        Staff::factory()->create(['email' => 'team@speedclub.test']);

        $this->postJson('/admin/login?remember=1', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests'])
            ->assertOk()
            ->assertCookieMissing(Auth::guard('staff')->getRecallerName());
    });

    it('is not set by the TOTP challenge', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create(['email' => 'team@speedclub.test']);

        $this->postJson('/admin/login', ['email' => 'team@speedclub.test', 'password' => 'password-for-tests', 'remember' => true])
            ->assertOk()
            ->assertJson(['two_factor' => true]);

        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt($staff->two_factor_secret))])
            ->assertNoContent()
            ->assertCookieMissing(Auth::guard('staff')->getRecallerName());
    });
});

describe('SEC-P1-40 non-string values on the staff steps', function () {
    it('answers an array address at the sign-in with 422, not a 500 from the limiter', function (mixed $email) {
        $this->postJson('/admin/login', ['email' => $email, 'password' => 'x'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    })->with([
        'list' => [['a@example.org']],
        'object' => [['a' => 1]],
        'number' => [123],
    ]);

    it('answers the same array as a form and through the query string', function () {
        $this->from('/admin/login')
            ->post('/admin/login', ['email' => ['a@example.org'], 'password' => 'x'])
            ->assertRedirect('/admin/login')
            ->assertSessionHasErrors('email');

        $this->postJson('/admin/login?email[]=a@example.org', ['password' => 'x'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    });

    it('counts array addresses at the sign-in under the limiter', function () {
        foreach (range(1, 5) as $ignored) {
            $this->postJson('/admin/login', ['email' => ['a@example.org'], 'password' => 'x'])->assertUnprocessable();
        }

        $this->postJson('/admin/login', ['email' => ['b@example.org'], 'password' => 'x'])->assertTooManyRequests();
    });

    it('does not fail in the limiter on an address that is not valid UTF-8', function () {
        $this->from('/admin/login')
            ->post('/admin/login', ['email' => "\xFF@example.org", 'password' => 'x'])
            ->assertRedirect('/admin/login');
    });

    it('does not tell a known address with a live link from an unknown one by a non-string token', function (mixed $token) {
        $known = Staff::factory()->create();
        Password::broker('staff')->createToken($known);
        $body = fn (string $email): array => ['email' => $email, 'token' => $token, 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'];

        $a = $this->postJson('/admin/reset-password', $body($known->email));
        $b = $this->postJson('/admin/reset-password', $body('nobody@example.org'));

        expect([$a->status(), $a->json('errors')])->toBe([$b->status(), $b->json('errors')])
            ->and($a->status())->toBe(422);
    })->with([
        'list' => [['aaaa']],
        'object' => [['a' => 1]],
    ]);

    it('answers a number as the token with 422 under token, for a known address too', function () {
        $known = Staff::factory()->create();

        // Only the middleware says this: Fortify's own rule lets a number through, and the broker would answer under email.
        $this->postJson('/admin/reset-password', ['email' => $known->email, 'token' => 123, 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('token');
    });

    it('answers an array address at the new-password step with 422', function () {
        $this->postJson('/admin/reset-password', ['email' => ['a@example.org'], 'token' => 'x', 'password' => 'y'])
            ->assertUnprocessable();
    });

    it('answers array values at the steps behind a session with 422', function (string $uri, array $body) {
        $staff = Staff::factory()->create(['two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey())]);

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson($uri, $body)
            ->assertUnprocessable();
    })->with([
        'password confirmation' => ['/admin/user/confirm-password', ['password' => ['x']]],
        'TOTP confirmation' => ['/admin/user/confirmed-two-factor-authentication', ['code' => ['1']]],
    ]);

    it('leaves string values to the steps themselves (controls)', function () {
        Notification::fake();
        Sleep::fake();
        $staff = Staff::factory()->create();

        $this->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();
        $this->postJson('/admin/reset-password', ['email' => $staff->email, 'token' => 'wrong', 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertUnprocessable();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertOk()->assertJson(['two_factor' => false]);
    });

    it('answers 422 under current_password, not a 500 from password_verify', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->putJson('/admin/user/password', ['current_password' => ['x'], 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('current_password');
    });

    it('names the field in the language of the message', function (string $locale, string $field, string $message) {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        // The admin's language is a cookie of its own (AdminLocale), not the app locale.
        $this->withCredentials()->withCookie(AdminLocale::COOKIE, $locale)->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->putJson('/admin/user/password', [$field => ['x'], 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertUnprocessable()
            ->assertJsonPath("errors.{$field}.0", $message);
    })->with([
        'de, current password' => ['de', 'current_password', 'Aktuelles Passwort muss Text sein.'],
        'en, current password' => ['en', 'current_password', 'The current password field must be text.'],
        'de, recovery code' => ['de', 'recovery_code', 'Wiederherstellungscode muss Text sein.'],
        'en, recovery code' => ['en', 'recovery_code', 'The recovery code field must be text.'],
    ]);

    it('takes an empty second field at the challenge as not sent', function (mixed $empty) {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();

        $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt($staff->two_factor_secret)), 'recovery_code' => $empty])
            ->assertNoContent();
    })->with([
        'null' => [null],
        'empty string' => [''],
    ]);

    it('answers an empty address with the required message, not the string message', function () {
        $this->postJson('/admin/login', ['email' => '', 'password' => 'x'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', __('validation.required', ['attribute' => __('validation.attributes.email')]));
    });
});

describe('SEC-P1-42 a long address at the staff sign-in', function () {
    beforeEach(fn () => staffLimiterOnDatabaseCache());

    it('answers 422, not a 500 from the attempt counter', function (int $length) {
        $this->postJson('/admin/login', ['email' => str_repeat('a', $length - strlen('@x.org')).'@x.org', 'password' => 'x'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
    })->with([
        'first length that overflowed' => [235],
        'column length' => [255],
        '300 characters' => [300],
        '1 KB' => [1024],
    ]);

    it('answers 413 at 1 MB, not a 500 from the attempt counter', function () {
        $this->postJson('/admin/login', ['email' => str_repeat('a', 1048576).'@x.org', 'password' => 'x'])
            ->assertStatus(413);
    });

    it('answers the same as a browser form', function () {
        $this->from('/admin/login')
            ->post('/admin/login', ['email' => str_repeat('a', 300).'@x.org', 'password' => 'x'])
            ->assertRedirect('/admin/login')
            ->assertSessionHasErrors('email');
    });

    it('still limits that address', function () {
        $email = str_repeat('a', 300).'@x.org';

        foreach (range(1, 5) as $ignored) {
            $this->postJson('/admin/login', ['email' => $email, 'password' => 'x'])->assertUnprocessable();
        }

        $this->postJson('/admin/login', ['email' => $email, 'password' => 'x'])->assertTooManyRequests();
    });

    it('keeps the address out of the key, and clears the count at the sign-in', function () {
        $staff = Staff::factory()->create();
        $counter = fn () => DB::table('cache')->where('key', 'like', '%staff-login:%');

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'wrong'])->assertUnprocessable();

        expect($counter()->count())->toBeGreaterThan(0)
            ->and(DB::table('cache')->where('key', 'like', '%'.$staff->email.'%')->count())->toBe(0);

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();

        expect($counter()->count())->toBe(0);
    });
});

describe('SEC-P1-43 a staff step does not store or process input without limit', function () {
    $routes = function (): array {
        app(Kernel::class);

        return collect(Route::getRoutes()->getRoutes())
            ->filter(fn (LaravelRoute $route): bool => str_starts_with((string) $route->getControllerClass(), 'Laravel\\Fortify\\'))
            ->all();
    };

    it('keeps the session small after a failed browser form', function (string $uri, array $body) {
        $this->from('/admin/login')->post($uri, $body);

        expect(staffSessionBytes())->toBeLessThan(65536);
    })->with([
        'sign-in, 1 MB in a field nothing reads' => ['/admin/login', ['email' => 'x@example.org', 'password' => 'x', 'junk' => str_repeat('a', 1048576)]],
        'sign-in, 1 MB address' => ['/admin/login', ['email' => str_repeat('a', 1048576).'@x.org', 'password' => 'x']],
        'sign-in, 1 MB _error_bag' => ['/admin/login', ['email' => 'x@example.org', 'password' => 'x', '_error_bag' => str_repeat('a', 1048576)]],
        'sign-in, array address and junk' => ['/admin/login', ['email' => ['a'], 'password' => 'x', 'junk' => str_repeat('a', 1048576)]],
        'reset form' => ['/admin/forgot-password', ['email' => 'not-an-address', 'junk' => str_repeat('a', 1048576)]],
        'new password' => ['/admin/reset-password', ['email' => 'not-an-address', 'token' => 'x', 'password' => 'y', 'password_confirmation' => 'y', 'junk' => str_repeat('a', 1048576)]],
    ]);

    it('keeps the session small when the body is JSON and only the Accept header asks for a redirect', function () {
        $this->call('POST', '/admin/login', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'text/html', 'HTTP_REFERER' => '/admin/login'], (string) json_encode(['email' => 'x@example.org', 'password' => 'x', 'junk' => str_repeat('a', 1048576)]));

        expect(staffSessionBytes())->toBeLessThan(65536);
    });

    it('keeps the session small on the limiter\'s own answer at the new-password step', function () {
        foreach (range(1, 5) as $i) {
            $this->postJson('/admin/reset-password', ['email' => "spent-{$i}@example.org", 'token' => 'x', 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1']);
        }
        session()->flush();

        $this->from('/admin/login')->post('/admin/reset-password', ['email' => str_repeat('a', 1048576).'@x.org', 'token' => 'x', 'password' => 'y', 'password_confirmation' => 'y']);

        expect(staffSessionBytes())->toBeLessThan(65536);
    });

    it('leaves no large row in the database session', function () {
        staffSessionsOnDatabase();

        $this->from('/admin/login')->post('/admin/login', ['email' => 'x@example.org', 'password' => 'x', 'junk' => str_repeat('a', 1048576)])
            ->assertStatus(413);

        expect(DB::table('sessions')->count())->toBe(0);
    });

    it('stores an ordinary failed form in the database session (control)', function () {
        staffSessionsOnDatabase();

        $this->from('/admin/login')->post('/admin/login', ['email' => 'x@example.org', 'password' => 'x'])
            ->assertRedirect('/admin/login');

        expect(DB::table('sessions')->count())->toBe(1);
    });

    it('does not read 1 MB at any anonymous step', function (string $uri, array $body) {
        $this->postJson($uri, $body)->assertStatus(413);
    })->with([
        'sign-in' => ['/admin/login', ['email' => str_repeat('a', 1048576), 'password' => 'x']],
        'reset form' => ['/admin/forgot-password', ['email' => str_repeat('a', 1048576)]],
        'new password' => ['/admin/reset-password', ['email' => str_repeat('a', 1048576), 'token' => 'x', 'password' => 'y', 'password_confirmation' => 'y']],
        'challenge' => ['/admin/two-factor-challenge', ['code' => str_repeat('a', 1048576)]],
    ]);

    it('does not read 1 MB behind a session either', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->putJson('/admin/user/password', ['current_password' => str_repeat('a', 1048576), 'password' => 'x', 'password_confirmation' => 'x'])
            ->assertStatus(413);
    });

    it('counts input from the query string', function () {
        // RefuseLongQuery stops a longer query on its own, so this one only goes over the line together with the body.
        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('p', 15800)])->assertUnprocessable();
        $this->postJson('/admin/login?junk='.str_repeat('a', 1000), ['email' => 'x@example.org', 'password' => str_repeat('p', 15800)])
            ->assertStatus(413);
    });

    it('answers a JSON client in the error format, and a browser in plain text', function () {
        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('a', 20000)])
            ->assertStatus(413)
            ->assertExactJson(['message' => ErrorCode::PayloadTooLarge->message(), 'code' => 'payload_too_large', 'errors' => []]);

        $browser = $this->post('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('a', 20000)]);

        $browser->assertStatus(413);
        expect($browser->getContent())->toBe(ErrorCode::PayloadTooLarge->message())
            ->and($browser->headers->get('Content-Type'))->toStartWith('text/plain');
    });

    it('counts an XHR that accepts anything as a JSON client, and sends errors as an object', function () {
        $response = $this->withHeaders(['X-Requested-With' => 'XMLHttpRequest', 'Accept' => '*/*'])
            ->post('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('a', 20000)]);

        $response->assertStatus(413)
            ->assertExactJson(['message' => ErrorCode::PayloadTooLarge->message(), 'code' => 'payload_too_large', 'errors' => []]);

        expect($response->getContent())->toContain('"errors":{}');
    });

    it('answers ahead of the limiter, and does not spend it', function () {
        foreach (range(1, 6) as $ignored) {
            $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('a', 20000)])->assertStatus(413);
        }

        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => 'x'])->assertUnprocessable();
    });

    it('still answers 413 once the limit is spent', function () {
        foreach (range(1, 5) as $ignored) {
            $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => 'x'])->assertUnprocessable();
        }

        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => 'x'])->assertTooManyRequests();
        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('a', 20000)])->assertStatus(413);
    });

    it('runs ahead of the session and every limiter on all of Fortify\'s routes', function () use ($routes) {
        $found = $routes();

        expect(count($found))->toBeGreaterThan(10);

        foreach ($found as $route) {
            $order = app('router')->gatherRouteMiddleware($route);
            $limit = array_search(LimitStaffStepInput::class, $order, true);

            expect($limit)->toBeInt($route->uri())
                ->and($limit)->toBeLessThan(array_search(StartSession::class, $order, true), $route->uri());

            foreach ($order as $index => $middleware) {
                if (is_string($middleware) && str_starts_with($middleware, ThrottleRequests::class)) {
                    expect($limit)->toBeLessThan($index, $route->uri());
                }
            }
        }
    });

    it('sits on no route other than Fortify\'s, so later admin pages can take long texts', function () use ($routes) {
        $found = array_map(fn (LaravelRoute $route): string => $route->uri().' '.$route->methods()[0], array_values($routes()));
        $carrying = collect(Route::getRoutes()->getRoutes())
            ->filter(fn (LaravelRoute $route): bool => in_array(LimitStaffStepInput::class, $route->gatherMiddleware(), true))
            ->map(fn (LaravelRoute $route): string => $route->uri().' '.$route->methods()[0])
            ->values()
            ->all();

        expect($carrying)->toEqualCanonicalizing($found);
    });

    it('does not count a file as input, and does not store it', function () {
        $this->from('/admin/login')
            ->post('/admin/login', ['email' => 'x@example.org', 'password' => 'x', 'junk' => UploadedFile::fake()->create('junk.bin', 1024)])
            ->assertRedirect('/admin/login');

        expect(staffSessionBytes())->toBeLessThan(65536);
    });

    it('keeps the address of an ordinary failed form (control)', function () {
        $this->from('/admin/login')->post('/admin/login', ['email' => 'x@example.org', 'password' => 'x'])
            ->assertRedirect('/admin/login')
            ->assertSessionHasErrors('email');

        expect(session()->getOldInput('email'))->toBe('x@example.org');
    });

    it('lets through what a person could send (control)', function () {
        $this->from('/admin/login')->post('/admin/login', ['email' => str_repeat('a', 300).'@x.org', 'password' => str_repeat('p', 8000)])
            ->assertRedirect('/admin/login');
        $this->postJson('/admin/login', ['email' => str_repeat('b', 300).'@x.org', 'password' => str_repeat('p', 8000)])
            ->assertUnprocessable();
    });

    it('draws the line at 16 KB of input', function (int $bytes, int $status) {
        $this->postJson('/admin/login', ['email' => 'x@example.org', 'password' => str_repeat('p', $bytes)])
            ->assertStatus($status);
    })->with([
        'below' => [16000, 422],
        'above' => [16384, 413],
    ]);
});

describe('SEC-P1-44 a staff request must not collect other sessions after 30 minutes', function () {
    beforeEach(function () {
        staffSessionsOnDatabase();
        config(['session.lifetime' => 120, 'session.lottery' => [1, 1]]);
    });

    $row = function (int $minutes): string {
        $id = Str::random(40);
        DB::table('sessions')->insert(['id' => $id, 'user_id' => null, 'ip_address' => '127.0.0.1', 'user_agent' => 'x', 'payload' => base64_encode('{}'), 'last_activity' => now()->subMinutes($minutes)->getTimestamp()]);

        return $id;
    };

    it('keeps a session idle for 45 of its 120 minutes when anyone opens the staff sign-in', function () use ($row) {
        $member = $row(45);

        $this->get('/admin/login')->assertOk();

        expect(DB::table('sessions')->where('id', $member)->exists())->toBeTrue();
    });

    it('collects at 120 minutes on a non-staff request (control)', function () use ($row) {
        $young = $row(45);
        $old = $row(130);

        $this->get('/sanctum/csrf-cookie')->assertNoContent();

        expect(DB::table('sessions')->where('id', $young)->exists())->toBeTrue()
            ->and(DB::table('sessions')->where('id', $old)->exists())->toBeFalse();
    });
});

describe('SEC-P1-45 secrets at the staff steps stay out of the session', function () {
    it('does not store a reset token after a failed new-password form', function () {
        $staff = Staff::factory()->create();
        $token = Password::broker('staff')->createToken($staff);

        $this->from('/admin/login')->post('/admin/reset-password', ['email' => $staff->email, 'token' => $token, 'password' => 'short', 'password_confirmation' => 'other'])
            ->assertRedirect();

        expect(session()->getOldInput('token'))->toBeNull()
            ->and(session()->getOldInput('email'))->toBe($staff->email);
    });

    it('does not store a code or a recovery code after a failed form', function () {
        $this->from('/admin/login')->post('/admin/login', ['email' => 'x@example.org', 'password' => 'x', 'code' => '123456', 'recovery_code' => 'aaaa-bbbb'])
            ->assertRedirect('/admin/login');

        expect(session()->getOldInput('code'))->toBeNull()
            ->and(session()->getOldInput('recovery_code'))->toBeNull()
            ->and(session()->getOldInput('email'))->toBe('x@example.org');
    });
});

describe('SEC-P1-47 anonymous session rows stay small', function () {
    it('does not store a long URL', function (string $path) {
        staffSessionsOnDatabase();

        $this->get($path.'?junk='.str_repeat('a', 7500))->assertStatus(414);

        expect(DB::table('sessions')->count())->toBe(0);
    })->with(['csrf cookie' => '/sanctum/csrf-cookie', 'sign-in page' => '/admin/login']);

    it('draws the line at 1 KB of query', function (int $bytes, int $status) {
        $this->get('/sanctum/csrf-cookie?'.str_repeat('a', $bytes - 2).'=b')->assertStatus($status);
    })->with([
        'at the line' => [1024, 204],
        'above' => [1025, 414],
    ]);

    it('keeps an ordinary URL working (control)', function (string $path, int $status) {
        staffSessionsOnDatabase();

        $this->get($path.'?x='.str_repeat('a', 900))->assertStatus($status);

        expect(DB::table('sessions')->count())->toBe(1)
            ->and(staffSessionRowBytes())->toBeLessThan(2048);
    })->with(['csrf cookie' => ['/sanctum/csrf-cookie', 204], 'sign-in page' => ['/admin/login', 200]]);

    it('leaves routes without a session and long search queries alone (control)', function () {
        $this->getJson('/api/v1/discover?q='.str_repeat('a', 1500))->assertSuccessful();
    });

    // A session cookie plus a first-party Referer gets Sanctum's chain on the API, where RefuseLongQuery does not sit (SEC-P1-49).
    // getJson() drops cookies without withCredentials(), so a test without it never touches the row.
    describe('on the stateful API chain', function () {
        beforeEach(function () {
            staffSessionsOnDatabase();
            config(['sanctum.stateful' => ['localhost:8080']]);
        });

        it('stores no long URL, whatever the answer', function (string $uri, int $status) {
            $id = statefulApiSessionRow();

            statefulApiBrowser($id)->getJson($uri)->assertStatus($status);

            expect(staffSessionRowBytes())->toBeLessThan(2048);
        })->with([
            'query, limited, 200' => ['/api/v1/discover?q='.str_repeat('a', 7900), 200],
            'query, no limiter, 401' => ['/api/v1/auth/me?q='.str_repeat('a', 7900), 401],
            'path, no limiter, 401' => ['/api/v1/vehicles/'.str_repeat('a', 7900), 401],
        ]);

        it('stores no long URL for a navigation either, which also leaves no intended URL', function () {
            $id = statefulApiSessionRow();

            statefulApiBrowser($id)->get('/api/v1/auth/me?q='.str_repeat('a', 7900))->assertUnauthorized();

            expect(staffSessionRowBytes())->toBeLessThan(2048);
        });

        it('stores no long URL in the limiter\'s own answer', function () {
            foreach (range(1, 60) as $ignored) {
                $this->getJson('/api/v1/usernames/check?username=secnine')->assertOk();
            }

            $id = statefulApiSessionRow();

            statefulApiBrowser($id)->getJson('/api/v1/usernames/check?username=secnine&q='.str_repeat('a', 7900))->assertStatus(429);

            expect(staffSessionRowBytes())->toBeLessThan(2048);
        });

        it('still serves a signed-in browser and keeps its row in use (control)', function () {
            $user = User::factory()->create();
            $id = statefulApiSessionRow([Auth::guard('web')->getName() => $user->getKey()]);
            $before = DB::table('sessions')->where('id', $id)->value('last_activity');

            statefulApiBrowser($id)->getJson('/api/v1/auth/me')->assertOk();

            expect(DB::table('sessions')->where('id', $id)->value('last_activity'))->toBeGreaterThan($before);
        });

        it('keeps a route with block() working', function () {
            Route::middleware('api')->get('/api/v1/test-block', fn () => response()->noContent())->block(1, 1);

            statefulApiBrowser(statefulApiSessionRow())->getJson('/api/v1/test-block')->assertNoContent();
        });

        it('leaves the previous URL of the web group alone, the staff forms go back with it (control)', function () {
            $this->get('/admin/login?x=1')->assertOk();

            expect(session()->previousUrl())->toEndWith('/admin/login?x=1');
        });
    });

    it('runs ahead of the session on the routes that have one', function () {
        app(Kernel::class);

        foreach (['sanctum.csrf-cookie', 'login', 'login.store'] as $name) {
            $order = app('router')->gatherRouteMiddleware(Route::getRoutes()->getByName($name));
            $refuse = array_search(RefuseLongQuery::class, $order, true);

            expect($refuse)->toBeInt($name)
                ->and($refuse)->toBeLessThan(array_search(StartSession::class, $order, true), $name);
        }
    });

    it('limits the sign-in per client, across addresses', function () {
        $statuses = [];
        foreach (range(1, 31) as $i) {
            $statuses[] = $this->postJson('/admin/login', ['email' => "n{$i}@example.org", 'password' => 'x'])->status();
        }

        expect(array_count_values($statuses))->toBe([422 => 30, 429 => 1]);
    });

    it('still limits one address at 5 (control)', function () {
        $statuses = [];
        foreach (range(1, 6) as $ignored) {
            $statuses[] = $this->postJson('/admin/login', ['email' => 'one@example.org', 'password' => 'x'])->status();
        }

        expect(array_count_values($statuses))->toBe([422 => 5, 429 => 1]);
    });

    it('stores no input in the limiter\'s own answer at the new-password step', function () {
        foreach (range(1, 5) as $i) {
            $this->postJson('/admin/reset-password', ['email' => "spent-{$i}@example.org", 'token' => 'x', 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1']);
        }
        session()->flush();

        $this->from('/admin/login')->post('/admin/reset-password', ['email' => str_repeat('a', 16000).'@x.org', 'token' => 'x', 'password' => 'y', 'password_confirmation' => 'y'])
            ->assertRedirect('/admin/login')
            ->assertSessionHasErrors('email');

        expect(strlen((string) json_encode(session()->all())))->toBeLessThan(2048);
    });
});

describe('SEC-P1-37 regression: a remember cookie never replaces the code', function () {
    it('ends the session it opened on a confirmed account', function () {
        $staff = Staff::factory()->twoFactorConfirmed()->create();
        [$name, $value] = staffRecallerCookie($staff);

        $this->withCookie($name, $value)->get('/admin')->assertRedirect('/admin/login');

        expect(Auth::guard('staff')->hasUser())->toBeFalse()
            ->and($staff->fresh()->remember_token)->not->toBe(str_repeat('r', 60));
    });

    it('stays behind the fence on an account without TOTP', function () {
        $staff = Staff::factory()->create();
        [$name, $value] = staffRecallerCookie($staff);

        $this->withCredentials()->withCookie($name, $value)->getJson('/admin')->assertStatus(409);
    });
});

describe('SEC-P1-35 enable and confirm work on the committed row', function () {
    it('leaves TOTP alone that another request confirmed after this model was loaded', function () {
        $stale = Staff::factory()->create(['two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey())]);
        staffConfirmsTotpElsewhere($stale);
        $before = Staff::query()->whereKey($stale->getKey())->sole();
        $locks = staffRowLocks();

        app(EnableTwoFactorAuthentication::class)($stale, true);

        $after = Staff::query()->whereKey($stale->getKey())->sole();

        expect($after->two_factor_secret)->toBe($before->two_factor_secret)
            ->and($after->two_factor_recovery_codes)->toBe($before->two_factor_recovery_codes)
            ->and($after->two_factor_confirmed_at)->not->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0)
            ->and($locks())->toBe(1);
    });

    it('leaves a pending secret alone that another request wrote after this model was loaded', function () {
        $stale = Staff::factory()->create();
        $pending = encrypt(app(Google2FA::class)->generateSecretKey());
        Staff::query()->whereKey($stale->getKey())->sole()->forceFill(['two_factor_secret' => $pending])->save();

        app(EnableTwoFactorAuthentication::class)($stale);

        expect(Staff::query()->whereKey($stale->getKey())->sole()->two_factor_secret)->toBe($pending)
            ->and(AuditEvent::query()->count())->toBe(0);
    });

    it('refuses a code for the old key once a forced enable has committed', function () {
        $old = app(Google2FA::class)->generateSecretKey();
        $stale = Staff::factory()->create(['two_factor_secret' => encrypt($old)]);
        Staff::query()->whereKey($stale->getKey())->sole()->forceFill(['two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey())])->save();
        $locks = staffRowLocks();

        $this->actingAs($stale, 'staff')->withSession([...staffConfirmedPassword(), ...staffStartedEnrolment($stale)])
            ->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => app(Google2FA::class)->getCurrentOtp($old)])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('code');

        expect(Staff::query()->whereKey($stale->getKey())->sole()->two_factor_confirmed_at)->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0)
            ->and($locks())->toBe(1);
    });

    it('confirms with a code for the key the row holds (control)', function () {
        $stale = Staff::factory()->create(['two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey())]);
        $current = app(Google2FA::class)->generateSecretKey();
        Staff::query()->whereKey($stale->getKey())->sole()->forceFill(['two_factor_secret' => encrypt($current)])->save();

        $this->actingAs($stale, 'staff')->withSession([...staffConfirmedPassword(), ...staffStartedEnrolment($stale)])
            ->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => app(Google2FA::class)->getCurrentOtp($current)])
            ->assertOk();

        expect(Staff::query()->whereKey($stale->getKey())->sole()->two_factor_confirmed_at)->not->toBeNull()
            ->and($stale->two_factor_confirmed_at)->not->toBeNull()
            ->and(AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorConfirmed->value)->count())->toBe(1);
    });

    it('rolls the enrolment back as a whole', function () {
        $staff = Staff::factory()->create();
        Event::listen(TwoFactorAuthenticationEnabled::class, function (): void {
            throw new RuntimeException('The audit log is down.');
        });

        expect(fn () => app(EnableTwoFactorAuthentication::class)($staff))->toThrow(RuntimeException::class);

        expect(Staff::query()->whereKey($staff->getKey())->sole()->two_factor_secret)->toBeNull()
            ->and(AuditEvent::query()->count())->toBe(0);
    });

    it('rolls the confirmation back as a whole, the session keeps its mark', function () {
        $staff = Staff::factory()->create();
        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk();
        nextStaffRequest();
        $this->withSession(staffConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        nextStaffRequest();
        $code = app(Google2FA::class)->getCurrentOtp(decrypt($staff->fresh()->two_factor_secret));
        Event::listen(TwoFactorAuthenticationConfirmed::class, function (): void {
            throw new RuntimeException('The audit log is down.');
        });

        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => $code])->assertServerError();

        expect($staff->fresh()->two_factor_confirmed_at)->toBeNull()
            ->and(session(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE))->toBeTrue();
    });
});

describe('EnableStaffTwoFactor keeps Fortify\'s events', function () {
    it('dispatches the enabled event once when an account enrols', function () {
        Event::fake([TwoFactorAuthenticationEnabled::class]);
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication')
            ->assertOk();

        Event::assertDispatchedTimes(TwoFactorAuthenticationEnabled::class, 1);
    });

    it('dispatches nothing for a refused forced re-enable on a confirmed account', function () {
        Event::fake([TwoFactorAuthenticationEnabled::class]);
        $staff = Staff::factory()->twoFactorConfirmed()->create();

        $this->actingAs($staff, 'staff')->withSession(staffConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication', ['force' => true])
            ->assertForbidden();
        app(EnableTwoFactorAuthentication::class)($staff, true);

        Event::assertNotDispatched(TwoFactorAuthenticationEnabled::class);
    });
});
