<?php

use App\Actions\Me\ConfirmTwoFactor;
use App\Enums\VerificationPurpose;
use App\Http\Middleware\LimitCsrfCookieRequests;
use App\Mail\EmailChangeCodeMail;
use App\Models\User;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactor;
use App\Services\Auth\VerificationCodes;
use App\Services\Support\Turnstile;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Settings/SettingsTestHelpers.php';

/**
 * Member-side carry-overs taken along with M3.1 (contract §1.8): SEC-P1-53, SEC-P2-07, SEC-P2-08, SEC-P2-09 and SEC-P2-13. Code review
 * M2.8 nit 10 is pinned in tests/Feature/Messaging/ConversationsTest.php.
 */
describe('SEC-P1-53 /sanctum/csrf-cookie', function () {
    it('limits anonymous requests per client, and its own 429 writes no session row', function () {
        config(['session.driver' => 'database']);
        $max = config()->integer('speedclub.rate_limits.csrf_cookie.max');

        foreach (range(1, $max) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->get('/sanctum/csrf-cookie')->assertNoContent();
        }

        $rows = DB::table('sessions')->count();

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->get('/sanctum/csrf-cookie')
            ->assertTooManyRequests()
            ->assertHeader('Retry-After')
            ->assertCookieMissing(config()->string('session.cookie'));

        expect(DB::table('sessions')->count())->toBe($rows);
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.10'])->get('/sanctum/csrf-cookie')->assertNoContent();
    });

    it('counts an IPv6 /64 as one client', function () {
        foreach (range(1, config()->integer('speedclub.rate_limits.csrf_cookie.max')) as $i) {
            $this->withServerVariables(['REMOTE_ADDR' => "2001:db8:7:8::$i"])->get('/sanctum/csrf-cookie');
        }

        $this->withServerVariables(['REMOTE_ADDR' => '2001:db8:7:8:1:2:3:4'])->get('/sanctum/csrf-cookie')->assertTooManyRequests();
    });

    it('runs ahead of the session', function () {
        app(Kernel::class);
        $order = app('router')->gatherRouteMiddleware(Route::getRoutes()->getByName('sanctum.csrf-cookie'));

        expect(array_search(LimitCsrfCookieRequests::class, $order, true))->toBeInt()->toBeLessThan(array_search(StartSession::class, $order, true));
    });
});

describe('SEC-P2-07 e-mail and password changes ask for the second factor', function () {
    it('needs a code to change the address when two-factor is on', function () {
        Mail::fake();
        $member = setMember(['email' => 'lena@example.de']);
        [$secret] = setEnableTwoFactor($member);
        Sanctum::actingAs($member, ['member']);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'two_factor_code_required')
            ->assertJsonValidationErrors('code');
        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password', 'code' => '000000'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.code.0', __('settings.code_wrong'));
        Mail::assertNotQueued(EmailChangeCodeMail::class);
        Mail::assertNotSent(EmailChangeCodeMail::class);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password', 'code' => setOtp($secret)])->assertStatus(202);
    });

    it('answers a wrong password first, before asking for the code', function () {
        $member = setMember();
        setEnableTwoFactor($member);
        Sanctum::actingAs($member, ['member']);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'wrong-wrong'])->assertJsonValidationErrors('password');
    });

    it('needs a code to change the password when two-factor is on', function () {
        $member = setMember();
        [$secret, $recovery] = setEnableTwoFactor($member);
        Sanctum::actingAs($member, ['member']);
        $body = ['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26'];

        $this->postJson('/api/v1/me/password', $body)->assertUnprocessable()->assertJsonPath('code', 'two_factor_code_required');
        expect(password_verify('password', (string) $member->fresh()?->password))->toBeTrue();

        $this->postJson('/api/v1/me/password', [...$body, 'code' => $recovery[0]])->assertNoContent();
        expect(password_verify('Ein-neues-Passwort-26', (string) $member->fresh()?->password))->toBeTrue();
    });

    it('asks nothing more without two-factor (control)', function () {
        $member = setMember();
        Sanctum::actingAs($member, ['member']);

        $this->postJson('/api/v1/me/password', ['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26'])->assertNoContent();
    });
});

describe('SEC-P2-08 a password reset does not refill the day\'s second-factor budget', function () {
    it('locks again at the next wrong code after a reset that followed the day limit', function () {
        $member = setMember();
        setEnableTwoFactor($member);
        $guard = app(SecondFactorGuard::class);

        // 9 + 9 + 2 wrong codes in three hours: the day's 20 lock it, no hour reaches 10.
        foreach ([9, 9, 2] as $failures) {
            foreach (range(1, $failures) as $i) {
                $guard->failed($member);
            }
            $this->travel(61)->minutes();
        }

        expect($member->fresh()?->hasLockedSecondFactor())->toBeTrue();

        $code = app(VerificationCodes::class)->issue($member->fresh() ?? $member, VerificationPurpose::PasswordReset);
        $this->postJson('/api/v1/auth/password/reset', ['email' => $member->email, 'code' => $code, 'password' => 'Neues-Passwort-2026!'])->assertOk();
        expect($member->fresh()?->hasLockedSecondFactor())->toBeFalse();

        $guard->failed($member->fresh() ?? $member);

        expect($member->fresh()?->hasLockedSecondFactor())->toBeTrue();
    });
});

describe('SEC-P2-09 confirming two-factor reads the secret under the lock', function () {
    it('refuses a code for a secret another device replaced in between', function () {
        $member = setMember();
        $service = app(TwoFactor::class);
        $started = $service->newSecret();
        $member->forceFill(['two_factor_secret' => $started])->save();

        // This request loaded the member with $started; another device's StartTwoFactor then wrote a new secret.
        User::query()->whereKey($member->id)->firstOrFail()->forceFill(['two_factor_secret' => $service->newSecret()])->save();

        expect(fn () => app(ConfirmTwoFactor::class)->handle($member, setOtp($started)))->toThrow(ValidationException::class);
        expect($member->fresh()?->hasTwoFactor())->toBeFalse();
    });

    it('confirms the secret this device started (control)', function () {
        $member = setMember();
        $secret = app(TwoFactor::class)->newSecret();
        $member->forceFill(['two_factor_secret' => $secret])->save();

        expect(app(ConfirmTwoFactor::class)->handle($member, setOtp($secret)))->toHaveCount(10)
            ->and($member->fresh()?->hasTwoFactor())->toBeTrue();
    });
});

describe('SEC-P2-13 Turnstile tokens count for their form and host only', function () {
    beforeEach(function () {
        config(['speedclub.services.turnstile_site_key' => 'site-key', 'speedclub.services.turnstile_secret' => 'secret']);
    });

    it('refuses a token solved for another form or another host', function (array $answer, bool $passes) {
        Http::fake(['challenges.cloudflare.com/*' => Http::response($answer)]);
        $this->get('/kontakt');

        expect(app(Turnstile::class)->passes('token', Turnstile::ACTION_CONTACT))->toBe($passes);
    })->with([
        'right form and host' => [['success' => true, 'action' => 'contact', 'hostname' => 'localhost'], true],
        'another form' => [['success' => true, 'action' => 'report', 'hostname' => 'localhost'], false],
        'another host' => [['success' => true, 'action' => 'contact', 'hostname' => 'evil.example'], false],
        'no action' => [['success' => true, 'hostname' => 'localhost'], false],
        'not solved' => [['success' => false, 'action' => 'contact', 'hostname' => 'localhost'], false],
    ]);

    it('names the action in each widget', function (string $page, string $action) {
        $this->get($page)->assertSee('data-action="'.$action.'"', false);
    })->with([
        'contact' => ['/kontakt', 'contact'],
        'account deletion' => ['/konto-loeschen', 'account_deletion'],
        'report' => ['/melden', 'report'],
    ]);
});
