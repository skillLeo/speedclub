<?php

use App\Enums\StaffSecurityEvent;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Support\ClientAddress;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Defer\DeferredCallbackCollection;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;

require_once __DIR__.'/Helpers.php';

/**
 * M3.1 contract §1.2: SEC-P1-03 (sign-in), -20 (seeded passwords), -21 and -29 (reset limits), -26 (password checks), -27 (log mailer),
 * and the IPv6 /64 rule for limiter keys.
 */
function m31Actions(): array
{
    return AuditEvent::query()->orderBy('id')->pluck('action')->all();
}

function m31SignIn(string $email, string $password, string $ip = '127.0.0.1'): TestResponse
{
    return test()->withServerVariables(['REMOTE_ADDR' => $ip])->postJson('/admin/login', ['email' => $email, 'password' => $password]);
}

describe('SEC-P1-03 the staff sign-in', function () {
    it('spends a hash on an unknown address too', function () {
        Cache::flush();

        m31SignIn('nobody@speedclub.test', 'whatever-password-1')->assertUnprocessable();

        expect(Cache::has('auth-dummy-hash:'.hash('sha256', (string) json_encode(config('hashing')))))->toBeTrue();
    });

    it('delays an address after five failures, whatever the client, and says so', function (bool $known) {
        $email = 'owner@speedclub.test';

        if ($known) {
            m31Staff(attributes: ['email' => $email]);
        }

        foreach (range(1, 5) as $i) {
            m31SignIn($email, 'wrong-password-'.$i, "10.0.0.$i")->assertUnprocessable();
        }

        // A sixth client, and for the known address the right password: the delay holds both alike.
        m31SignIn($email, 'password-for-tests', '10.0.9.9')
            ->assertStatus(429)
            ->assertJsonValidationErrors('email');

        expect(Auth::guard('staff')->check())->toBeFalse();
    })->with(['known address' => true, 'unknown address' => false]);

    it('lets the right password in once the delay has passed', function () {
        $staff = m31Staff(confirmed: false, attributes: ['email' => 'owner@speedclub.test']);

        foreach (range(1, 5) as $i) {
            m31SignIn($staff->email, 'wrong-password-'.$i, "10.0.0.$i");
        }

        $this->travel(5)->minutes();

        m31SignIn($staff->email, 'password-for-tests', '10.0.9.9')->assertOk();
    });

    it('answers a suspended account like a wrong password, audited', function () {
        $staff = m31Staff(attributes: ['status' => 'suspended']);

        m31SignIn($staff->email, 'password-for-tests')->assertUnprocessable()->assertJsonValidationErrors('email');

        expect(AuditEvent::query()->where('action', StaffSecurityEvent::SignInFailed->value)->sole()->after)->toBe(['reason' => 'inactive']);
    });

    it('audits sign-in, failure, a wrong code at the challenge and sign-out, for known accounts only', function () {
        $staff = m31Staff(confirmed: false);

        m31SignIn('nobody@speedclub.test', 'wrong-password-1');
        expect(m31Actions())->toBe([]);

        m31SignIn($staff->email, 'wrong-password-1');
        m31SignIn($staff->email, 'password-for-tests')->assertOk();
        $this->postJson('/admin/logout')->assertNoContent();

        expect(m31Actions())->toBe([
            StaffSecurityEvent::SignInFailed->value,
            StaffSecurityEvent::SignedIn->value,
            StaffSecurityEvent::SignedOut->value,
        ]);

        $confirmed = m31Staff();
        m31SignIn($confirmed->email, 'password-for-tests')->assertOk();
        $this->postJson('/admin/two-factor-challenge', ['code' => '000000'])->assertUnprocessable();

        expect(AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorFailed->value)->where('target_id', (string) $confirmed->id)->exists())->toBeTrue();
    });

    it('audits a password change and a reset, without the password', function () {
        $staff = m31Staff();

        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())
            ->putJson('/admin/user/password', ['current_password' => 'password-for-tests', 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'])
            ->assertOk();

        $this->flushSession();
        Auth::guard('staff')->logout();
        $token = Password::broker('staff')->createToken($staff->fresh() ?? $staff);
        $this->postJson('/admin/reset-password', ['token' => $token, 'email' => $staff->email, 'password' => 'a-third-staff-password', 'password_confirmation' => 'a-third-staff-password'])->assertOk();

        $rows = AuditEvent::query()->whereIn('action', [StaffSecurityEvent::PasswordChanged->value, StaffSecurityEvent::PasswordReset->value])->get();

        expect($rows->pluck('action')->all())->toBe([StaffSecurityEvent::PasswordChanged->value, StaffSecurityEvent::PasswordReset->value])
            ->and((string) json_encode($rows->toArray()))->not->toContain('a-new-staff-password-1')->not->toContain('a-third-staff-password');
    });

    it('records the time of the last sign-in', function () {
        $staff = m31Staff(confirmed: false);

        m31SignIn($staff->email, 'password-for-tests')->assertOk();

        expect($staff->fresh()?->getAttribute('last_login_at'))->not->toBeNull();
    });
});

describe('SEC-P1-20 a seeded password cannot claim an account', function () {
    it('keeps an account out until its owner proved the mailbox, with a message only for the right password', function () {
        $staff = m31Staff(confirmed: false, attributes: ['password_proof_required' => true]);

        m31SignIn($staff->email, 'wrong-password-1')->assertJsonPath('errors.email.0', __('auth.failed'));
        m31SignIn($staff->email, 'password-for-tests')
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', __('staff_auth.password_proof_required'));

        expect(Auth::guard('staff')->check())->toBeFalse();
    });

    it('opens the account once the password was set through the mailed link', function () {
        $staff = m31Staff(confirmed: false, attributes: ['password_proof_required' => true]);
        $token = Password::broker('staff')->createToken($staff);

        $this->postJson('/admin/reset-password', ['token' => $token, 'email' => $staff->email, 'password' => 'my-own-password-1', 'password_confirmation' => 'my-own-password-1'])->assertOk();

        expect($staff->fresh()?->password_proof_required)->toBeFalse();
        m31SignIn($staff->email, 'my-own-password-1', '10.1.1.1')->assertOk();
    });

    it('seeds accounts outside local and testing with the proof required', function () {
        m31Roles();
        app()->detectEnvironment(fn (): string => 'staging');
        config(['speedclub.staff.owner_email' => 'owner@speedclub.test', 'speedclub.demo.staff_password' => 'a-shared-demo-password']);

        (new StaffSeeder)->run();

        expect(Staff::query()->where('email', 'owner@speedclub.test')->sole()->password_proof_required)->toBeTrue()
            ->and(Staff::query()->where('password_proof_required', false)->count())->toBe(0);
    });
});

describe('SEC-P1-26 password checks of a signed-in session', function () {
    it('counts wrong passwords per account across sessions, and then refuses the right one too', function (string $method, string $uri, string $field) {
        $staff = m31Staff();
        $body = fn (string $password): array => $field === 'password'
            ? ['password' => $password]
            : ['current_password' => $password, 'password' => 'a-new-staff-password-1', 'password_confirmation' => 'a-new-staff-password-1'];

        foreach (range(1, 5) as $i) {
            $this->flushSession();
            $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->json($method, $uri, $body('wrong-password-'.$i))->assertUnprocessable();
        }

        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->json($method, $uri, $body('password-for-tests'))
            ->assertTooManyRequests()
            ->assertHeader('Retry-After')
            ->assertJsonPath('code', 'rate_limited');

        expect(AuditEvent::query()->where('action', StaffSecurityEvent::PasswordCheckFailed->value)->count())->toBe(5)
            ->and(password_verify('password-for-tests', (string) $staff->fresh()?->password))->toBeTrue();
    })->with([
        'confirmation' => ['POST', '/admin/user/confirm-password', 'password'],
        'password change' => ['PUT', '/admin/user/password', 'current_password'],
    ]);

    it('does not count the right password', function () {
        $staff = m31Staff();

        foreach (range(1, 8) as $i) {
            $this->actingAs($staff, 'staff')->postJson('/admin/user/confirm-password', ['password' => 'password-for-tests'])->assertCreated();
        }
    });

    it('answers the browser form at the limit with an error on the field', function () {
        $staff = m31Staff();

        foreach (range(1, 6) as $i) {
            $response = $this->actingAs($staff, 'staff')->from('/admin/user/confirm-password')->post('/admin/user/confirm-password', ['password' => 'wrong-'.$i]);
        }

        $response->assertRedirect('/admin/user/confirm-password')->assertSessionHasErrors('password');
        expect(session('errors')->first('password'))->toStartWith(Str::before((string) __('staff_auth.password_check_locked'), ':time'));
    });
});

describe('SEC-P1-27 the staff reset link and the log mailer', function () {
    it('sends no link in production with the log mailer', function () {
        Notification::fake();
        $staff = m31Staff();
        app()->detectEnvironment(fn (): string => 'production');
        config(['mail.default' => 'log']);

        $staff->sendPasswordResetNotification('a-token');
        app(DeferredCallbackCollection::class)->invoke();

        Notification::assertNothingSent();
    });

    it('sends it with a real mailer (control)', function () {
        Notification::fake();
        $staff = m31Staff();
        app()->detectEnvironment(fn (): string => 'production');
        config(['mail.default' => 'smtp']);

        $staff->sendPasswordResetNotification('a-token');
        app(DeferredCallbackCollection::class)->invoke();

        Notification::assertSentTo($staff, ResetPassword::class);
    });
});

describe('SEC-P1-21 and SEC-P1-29 the reset limits per address', function () {
    it('does not let requests that sent nothing hold back the owner\'s own link', function () {
        Notification::fake();
        $staff = m31Staff();

        // Five requests from strangers within the broker's 60 seconds: one link, four held by the broker.
        foreach (range(1, 5) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();
        }

        $this->travel(2)->minutes();
        $this->withServerVariables(['REMOTE_ADDR' => '10.9.9.9'])->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();

        Notification::assertSentTimes(ResetPassword::class, 2);
    });

    it('counts accent variants of an address under one key at the new-password step', function () {
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');
        $body = fn (string $email): array => ['email' => $email, 'token' => 'wrong', 'password' => 'x', 'password_confirmation' => 'x'];

        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "10.0.0.$i"])->postJson('/admin/reset-password', $body($i % 2 === 0 ? 'tīme@speedclub.test' : 'tíme@speedclub.test'));
        }

        $this->withServerVariables(['REMOTE_ADDR' => '10.0.9.9'])->postJson('/admin/reset-password', $body('time@speedclub.test'))->assertTooManyRequests();
    });
});

describe('IPv6 clients count by their /64', function () {
    it('keys an IPv6 address on its /64 and leaves IPv4 alone', function () {
        expect(ClientAddress::of('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))->toBe('2001:db8:1:2::/64')
            ->and(ClientAddress::of('2001:db8:1:2::1'))->toBe(ClientAddress::of('2001:db8:1:2:ffff::9'))
            ->and(ClientAddress::of('2001:db8:1:3::1'))->not->toBe(ClientAddress::of('2001:db8:1:2::1'))
            ->and(ClientAddress::of('203.0.113.7'))->toBe('203.0.113.7')
            ->and(ClientAddress::of('::ffff:203.0.113.7'))->toBe('203.0.113.7');
    });

    it('limits one /64 at the staff reset form as one client', function () {
        Notification::fake();
        $staff = m31Staff();
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');

        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "2001:db8:1:2::$i"])->postJson('/admin/forgot-password', ['email' => "nobody$i@speedclub.test"]);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '2001:db8:1:2:ffff::1'])->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();
        Notification::assertNothingSent();

        $this->withServerVariables(['REMOTE_ADDR' => '2001:db8:1:3::1'])->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();
        Notification::assertSentTimes(ResetPassword::class, 1);
    });

    it('limits one /64 at a member limiter as one client', function () {
        $max = config()->integer('speedclub.rate_limits.member_login.max');

        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "2001:db8:5:6::$i"])->postJson('/api/v1/auth/login', ['email' => "nobody$i@speedclub.test", 'password' => 'whatever-1', 'device_id' => 'test-device']);
        }

        $this->withServerVariables(['REMOTE_ADDR' => '2001:db8:5:6:9::9'])->postJson('/api/v1/auth/login', ['email' => 'x@speedclub.test', 'password' => 'whatever-1'])->assertTooManyRequests();
    });
});

it('lets a confirmed account through the challenge (control for the delay)', function () {
    $staff = m31Staff();
    m31SignIn($staff->email, 'password-for-tests')->assertOk();

    $this->postJson('/admin/two-factor-challenge', ['code' => app(Google2FA::class)->getCurrentOtp(decrypt((string) $staff->two_factor_secret))])->assertNoContent();
    expect(Auth::guard('staff')->id())->toBe($staff->id);
});
