<?php

use App\Http\Middleware\EnsureStaffTwoFactor;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;
use PragmaRX\Google2FA\Google2FA;

require_once __DIR__.'/Helpers.php';

/**
 * M3.1 contract §1.1: Fortify renders the Inertia pages ADM-01…04, every route name it redirects to exists (SEC-P1-30), the reset link
 * keeps token and address out of the URL a server sees (SEC-P1-07), TOTP keys have 160 bits (SEC-P1-38) and no staff answer may be
 * stored by a browser (SEC-P1-28).
 */
describe('Fortify pages for Inertia (ADM-01…04)', function () {
    it('names every route Fortify redirects to', function () {
        foreach (['login', 'two-factor.login', 'password.request', 'password.reset', 'password.confirm', 'admin.two-factor.setup'] as $name) {
            expect(Route::has($name))->toBeTrue($name);
        }
    });

    it('renders the sign-in page with the status of a previous step', function () {
        $this->withSession(['status' => 'Ein Link ist unterwegs.'])->get('/admin/login')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/Login')->where('status', 'Ein Link ist unterwegs.'));
    });

    it('renders the forgot-password page', function () {
        $this->get('/admin/forgot-password')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/ForgotPassword')->where('status', null));
    });

    it('renders the reset page without a token in its path, and gives it neither token nor address', function () {
        $this->get('/admin/reset')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/ResetPassword')->where('token', null)->where('email', null));
    });

    it('renders the password confirmation for a signed-in account', function () {
        $this->actingAs(m31Staff(), 'staff')->get('/admin/user/confirm-password')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/ConfirmPassword'));
    });

    it('renders the challenge only with a pending sign-in, and sends anyone else to the sign-in', function () {
        $staff = m31Staff();

        $this->get('/admin/two-factor-challenge')->assertRedirect('/admin/login');

        $this->post('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertRedirect('/admin/two-factor-challenge');
        $this->get('/admin/two-factor-challenge')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/TwoFactorChallenge'));
    });
});

describe('SEC-P1-30 browser forms end on a page, not in a 500', function () {
    it('sends a wrong code at the challenge back to the challenge page', function () {
        $staff = m31Staff();
        $this->post('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests']);

        $this->from('/admin/two-factor-challenge')->post('/admin/two-factor-challenge', ['code' => '000000'])
            ->assertRedirect('/admin/two-factor-challenge')
            ->assertSessionHasErrors('code');

        expect(auth('staff')->check())->toBeFalse();
    });

    it('answers an anonymous form at the challenge with a redirect and an error', function () {
        $this->post('/admin/two-factor-challenge', ['code' => '123456'])->assertRedirect()->assertSessionHasErrors('code');

        expect(auth('staff')->check())->toBeFalse();
    });

    it('sends a step behind the password confirmation to the confirmation page', function () {
        $this->actingAs(m31Staff(confirmed: false), 'staff')
            ->post('/admin/user/two-factor-authentication')
            ->assertRedirect('/admin/user/confirm-password');
    });

    it('sends a password-only sign-in of a confirmed account to the challenge', function () {
        $staff = m31Staff();

        $this->post('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])
            ->assertRedirect('/admin/two-factor-challenge');
    });
});

describe('SEC-P1-07 the reset link', function () {
    it('carries token and address in the fragment only', function () {
        Notification::fake();
        $staff = m31Staff(attributes: ['email' => 'owner+ops@speedclub.test']);

        $this->postJson('/admin/forgot-password', ['email' => $staff->email])->assertOk();

        Notification::assertSentTo($staff, ResetPassword::class, function (ResetPassword $notification) use ($staff): bool {
            $url = (string) $notification->toMail($staff)->actionUrl;
            [$before, $fragment] = explode('#', $url, 2) + ['', ''];
            parse_str($fragment, $values);

            return $before === rtrim(config()->string('app.url'), '/').'/admin/reset'
                && $values['email'] === 'owner+ops@speedclub.test'
                && Password::broker('staff')->tokenExists($staff, (string) $values['token']);
        });
    });

    it('builds the link on ADMIN_DOMAIN when the admin lives there', function () {
        Notification::fake();
        config(['speedclub.staff.domain' => 'team.speedclub.test']);
        $staff = m31Staff();

        $this->withServerVariables(['HTTP_HOST' => 'team.speedclub.test'])->postJson('http://team.speedclub.test/admin/forgot-password', ['email' => $staff->email])->assertOk();

        Notification::assertSentTo($staff, ResetPassword::class, fn (ResetPassword $notification): bool => str_starts_with(
            (string) $notification->toMail($staff)->actionUrl,
            parse_url(config()->string('app.url'), PHP_URL_SCHEME).'://team.speedclub.test/admin/reset#token=',
        ));
    });

    it('still resets with token and address in the body', function () {
        $staff = m31Staff();
        $token = Password::broker('staff')->createToken($staff);

        $this->postJson('/admin/reset-password', [
            'token' => $token,
            'email' => $staff->email,
            'password' => 'a-new-staff-password-1',
            'password_confirmation' => 'a-new-staff-password-1',
        ])->assertOk();

        expect(password_verify('a-new-staff-password-1', (string) $staff->fresh()?->password))->toBeTrue();
    });
});

describe('SEC-P1-38 TOTP keys', function () {
    it('have 32 base32 characters, 160 bits', function () {
        $staff = m31Staff(confirmed: false);

        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())
            ->postJson('/admin/user/two-factor-authentication')
            ->assertOk();

        expect(strlen(decrypt((string) $staff->fresh()?->two_factor_secret)))->toBe(32);
    });
});

describe('SEC-P1-28 nothing of the staff side is stored by a browser', function () {
    it('answers the TOTP material with no-store', function (string $uri) {
        $staff = m31Staff(confirmed: false);
        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();

        $response = $this->getJson($uri)->assertOk();

        expect((string) $response->headers->get('Cache-Control'))->toContain('no-store');
    })->with([
        'secret key' => ['/admin/user/two-factor-secret-key'],
        'QR code' => ['/admin/user/two-factor-qr-code'],
    ]);

    it('answers the recovery codes and every admin page with no-store', function () {
        $staff = m31Staff('owner');

        // The one read right after the confirmation (SEC-P1-36); ADM-51 answers no-store as well.
        $this->actingAs($staff, 'staff')->withSession([...m31ConfirmedPassword(), EnsureStaffTwoFactor::RECOVERY_CODES_ONCE => true])->getJson('/admin/user/two-factor-recovery-codes')
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private');

        $this->get('/admin/login');
        $this->actingAs($staff, 'staff')->get('/admin')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
    });
});

describe('SEC-P1-33 a pending key belongs to the session that started it', function () {
    it('answers another session of the account 409, also after the owner restarted', function (string $method, string $uri) {
        $staff = m31Staff(confirmed: false);
        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        $this->getJson('/admin/user/two-factor-secret-key')->assertOk();

        // Another browser of the same account: signed in, password confirmed, but it did not start this enrolment.
        $this->flushSession();
        $this->actingAs($staff->fresh() ?? $staff, 'staff')->withSession(m31ConfirmedPassword())
            ->json($method, $uri, ['code' => '123456'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'conflict');
    })->with([
        'secret key' => ['GET', '/admin/user/two-factor-secret-key'],
        'QR code' => ['GET', '/admin/user/two-factor-qr-code'],
        'confirm' => ['POST', '/admin/user/confirmed-two-factor-authentication'],
    ]);

    it('lets the session that started it read and confirm (control)', function () {
        $staff = m31Staff(confirmed: false);
        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        $secret = decrypt((string) $staff->fresh()?->two_factor_secret);

        $this->getJson('/admin/user/two-factor-secret-key')->assertOk()->assertJsonPath('secretKey', $secret);
        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => app(Google2FA::class)->getCurrentOtp($secret)])->assertOk();

        expect($staff->fresh()?->two_factor_confirmed_at)->not->toBeNull();
    });

    it('moves the key to the session that forces a new enrolment', function () {
        $staff = m31Staff(confirmed: false);
        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();
        $first = session(EnsureStaffTwoFactor::PENDING_SECRET);

        $this->postJson('/admin/user/two-factor-authentication', ['force' => true])->assertOk();

        expect(session(EnsureStaffTwoFactor::PENDING_SECRET))->toBeString()->not->toBe($first);
        $this->getJson('/admin/user/two-factor-secret-key')->assertOk();
    });
});

describe('SEC-P1-34 two-factor.confirm', function () {
    it('is closed once TOTP is confirmed', function () {
        $staff = m31Staff();

        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())
            ->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => '123456'])
            ->assertForbidden();

        expect(EnsureStaffTwoFactor::CLOSED_ONCE_CONFIRMED)->toContain('two-factor.confirm');
    });

    it('takes five guesses a minute during enrolment', function () {
        $staff = m31Staff(confirmed: false);
        $this->actingAs($staff, 'staff')->withSession(m31ConfirmedPassword())->postJson('/admin/user/two-factor-authentication')->assertOk();

        foreach (range(1, 5) as $guess) {
            $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => '000000'])->assertUnprocessable();
        }

        $this->postJson('/admin/user/confirmed-two-factor-authentication', ['code' => '000000'])->assertTooManyRequests();
    });
});
