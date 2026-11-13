<?php

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Mail\EmailCodeMail;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\LoginAttempt;
use App\Models\MemberPasskey;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Auth\IdTokens\IdTokenVerifier;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Support\FakeIdTokens;
use Tests\Support\VirtualAuthenticator;

require_once __DIR__.'/Helpers.php';
require_once __DIR__.'/../Settings/SettingsTestHelpers.php';

/**
 * The security review of M4.6 (SEC-M46-01 … 06): the auditor's exploit probes, turned round. Each test performs the attack and passes
 * only while the hole stays closed. SEC-M46-04 (Mail-Vorschau) lives in MailPreviewTest, which sends real mails.
 */
const SR46_ORIGIN = 'https://speedclub.test';
const SR46_PASSWORD = 'Sehr-Geheimes-Passwort-91';

beforeEach(function () {
    Mail::fake();
    Cache::flush();
    FakeIdTokens::install(['test-kid']);
    config([
        'app.url' => SR46_ORIGIN,
        'speedclub.passkeys.rp_id' => 'speedclub.test',
        'speedclub.passkeys.allowed_origins' => [],
        'speedclub.email_code.min_response_ms' => 0,
    ]);
    a20Flag('auth.passkeys');
    a20Flag('auth.google');
    a20Flag('auth.apple');
});

function sr46Fresh(): void
{
    app('auth')->forgetGuards();
    test()->flushHeaders();
}

/** The attacker registers the victim's address with his own password and signs in unverified (ADR-133). */
function sr46AttackerUnverified(string $email): string
{
    test()->postJson('/api/v1/auth/register', ['email' => $email, 'password' => SR46_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])->assertStatus(202);
    sr46Fresh();
    $token = test()->postJson('/api/v1/auth/login', ['email' => $email, 'password' => SR46_PASSWORD, 'device_name' => 'Attacker PC'])->assertOk()->json('data.token');
    sr46Fresh();

    return (string) $token;
}

/** An unverified account that (as before the fix) already holds a stranger's passkey and Google link. */
function sr46PreHijacked(string $email): User
{
    $user = User::factory()->unverified()->create(['email' => $email]);
    MemberPasskey::factory()->create(['user_id' => $user->id]);
    SocialAccount::factory()->create(['user_id' => $user->id, 'provider_sub' => 'attacker-sub-1', 'email' => 'attacker@gmail.com']);

    return $user;
}

function sr46ResetCode(): string
{
    $mail = Mail::sent(PasswordResetCodeMail::class)->last() ?? Mail::queued(PasswordResetCodeMail::class)->last();

    if (! $mail instanceof PasswordResetCodeMail) {
        throw new RuntimeException('No PasswordResetCodeMail.');
    }

    return (string) $mail->code;
}

describe('SEC-M46-01 pre-hijack through passkeys and providers', function () {
    it('refuses a passkey and a provider link on an unverified account', function () {
        $token = sr46AttackerUnverified('opfer@beispiel.test');

        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertForbidden()->assertJsonPath('code', ErrorCode::EmailNotVerified->value);
        sr46Fresh();
        $this->withToken($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/me/passkeys', ['ceremony_id' => (string) Str::ulid(), 'credential' => ['id' => 'x']])
            ->assertForbidden()->assertJsonPath('code', ErrorCode::EmailNotVerified->value);
        sr46Fresh();
        $this->withToken($token)->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput(['sub' => 'attacker-sub-1', 'email' => 'attacker@gmail.com'], 'raw_nonce')])
            ->assertForbidden()->assertJsonPath('code', ErrorCode::EmailNotVerified->value);

        expect(MemberPasskey::query()->count())->toBe(0)->and(SocialAccount::query()->count())->toBe(0);
    });

    it('PROBE passkey: the attacker passkey never signs in after the owner proves the mailbox', function () {
        $email = 'opfer@beispiel.test';
        $token = sr46AttackerUnverified($email);
        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertForbidden();

        sr46Fresh();
        [$attempt, $code] = a20Start($email);
        sr46Fresh();
        $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $attempt, 'code' => $code, ...a20Device('Victim phone', 'install-victim-0001')])->assertOk();

        sr46Fresh();
        $auth = new VirtualAuthenticator;
        $sign = $this->postJson('/api/v1/auth/passkeys/options')->assertOk()->json('data');
        sr46Fresh();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $sign['ceremony_id'], 'credential' => $auth->assert($sign['options'], SR46_ORIGIN), ...a20Device('Attacker PC', 'install-att-0001')])
            ->assertStatus(422);
    });

    it('clears passkeys, providers, ceremonies and open codes when the owner proves the mailbox', function (string $path) {
        $email = 'opfer@beispiel.test';
        $user = sr46PreHijacked($email);
        $openCode = LoginAttempt::factory()->create(['user_id' => $user->id, 'purpose' => LoginPurpose::Reauth, 'consumed_at' => null]);

        match ($path) {
            'email_code' => (function () use ($email): void {
                [$attempt, $code] = a20Start($email);
                sr46Fresh();
                test()->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $attempt, 'code' => $code, ...a20Device('Victim phone', 'install-victim-0001')])->assertOk();
            })(),
            'google' => test()->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'victim-own-sub', 'email' => $email]), ...a20Device('Victim phone', 'install-victim-0001')])->assertOk(),
            'password_reset' => (function () use ($email): void {
                test()->postJson('/api/v1/auth/password/forgot', ['email' => $email])->assertSuccessful();
                sr46Fresh();
                test()->postJson('/api/v1/auth/password/reset', ['email' => $email, 'code' => sr46ResetCode(), 'password' => 'Ein-Ganz-Neues-Passwort-77'])->assertSuccessful();
            })(),
        };

        $user->refresh();
        expect($user->hasVerifiedEmail())->toBeTrue()
            ->and(MemberPasskey::query()->where('user_id', $user->id)->count())->toBe(0)
            ->and(SocialAccount::query()->where('user_id', $user->id)->where('provider_sub', 'attacker-sub-1')->exists())->toBeFalse()
            ->and(LoginAttempt::query()->whereKey($openCode->id)->exists())->toBeFalse()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::UnprovenDataCleared->value)->where('target_id', $user->id)->exists())->toBeTrue();

        // The owner's own Google account (the proof itself) stays.
        if ($path === 'google') {
            expect(SocialAccount::query()->where('user_id', $user->id)->where('provider_sub', 'victim-own-sub')->exists())->toBeTrue();
        }

        sr46Fresh();
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'attacker-sub-1', 'email' => 'attacker@gmail.com']), ...a20Device('Attacker PC', 'install-att-0002')])
            ->assertOk()->assertJsonPath('data.is_new', true);
        expect(User::query()->where('email', 'attacker@gmail.com')->value('id'))->not->toBe($user->id);
    })->with(['email_code', 'google', 'password_reset']);
});

describe('SEC-M46-02 two-factor and provider links', function () {
    it('PROBE: a mailbox-only attacker cannot link past TOTP; the link of the owner waits for the second factor', function () {
        $email = 'lena@beispiel.test';
        $user = User::factory()->create(['email' => $email]);
        [$secret] = setEnableTwoFactor($user);

        $link = $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'g-sub-1', 'email' => $email]), ...a20Device()])->assertStatus(202);
        $attempt = (string) $link->json('data.attempt_id');
        $code = (string) a20LastCode()->code;

        sr46Fresh();
        $confirm = $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => $attempt, 'code' => $code, ...a20Device()])->assertOk()
            ->assertJsonPath('data.two_factor_required', true);
        expect($confirm->json('data.token'))->toBeNull()
            ->and(SocialAccount::query()->where('user_id', $user->id)->count())->toBe(0);

        // The attacker's second Google sign-in finds no link: AUTH-16 again, no token.
        sr46Fresh();
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'g-sub-1', 'email' => $email]), ...a20Device()])
            ->assertStatus(202)->assertJsonPath('data.token', null);

        // The owner passes the second factor: now the link is made, tied to it.
        sr46Fresh();
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $confirm->json('data.challenge'), 'code' => setOtp($secret), ...a20Device()])->assertOk();
        $account = SocialAccount::query()->where('user_id', $user->id)->first();
        expect($account?->provider_sub)->toBe('g-sub-1')->and($account?->getAttribute('second_factor_at'))->not->toBeNull();

        sr46Fresh();
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'g-sub-1', 'email' => $email]), ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id);
    });

    it('asks a provider never tied to a second factor for the code once', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        [$secret] = setEnableTwoFactor($user);
        $account = SocialAccount::factory()->create(['user_id' => $user->id, 'provider_sub' => 'old-link-sub']);

        $first = $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'old-link-sub']), ...a20Device()])->assertOk()
            ->assertJsonPath('data.two_factor_required', true);
        expect($first->json('data.token'))->toBeNull();

        sr46Fresh();
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $first->json('data.challenge'), 'code' => setOtp($secret), ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id);
        expect($account->fresh()?->getAttribute('second_factor_at'))->not->toBeNull();

        sr46Fresh();
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'old-link-sub']), ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id);
    });

    it('links at once on an account without two-factor', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);

        $attempt = (string) $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['sub' => 'g-sub-2']), ...a20Device()])->assertStatus(202)->json('data.attempt_id');
        sr46Fresh();
        $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => $attempt, 'code' => (string) a20LastCode()->code, ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id);

        expect(SocialAccount::query()->where('user_id', $user->id)->where('provider_sub', 'g-sub-2')->exists())->toBeTrue();
    });
});

describe('SEC-M46-03 e-mail code lockout', function () {
    it('PROBE: random attempt ids neither lock the address nor close the owner code', function () {
        $email = 'lena@beispiel.test';
        User::factory()->create(['email' => $email]);
        [$attempt, $code] = a20Start($email);

        for ($i = 0; $i < 12; $i++) {
            sr46Fresh();
            $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()])->assertStatus(422);
        }

        sr46Fresh();
        $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])->assertOk();
        Mail::assertNotSent(SecurityNoticeMail::class);
    });

    it('locks only the client that failed, not the owner elsewhere', function () {
        $email = 'lena@beispiel.test';
        User::factory()->create(['email' => $email]);
        config(['speedclub.rate_limits.auth_email_verify.max' => 1000]);

        // The attacker asks for codes himself and fails them from one address.
        for ($round = 0; $round < 2; $round++) {
            $this->travel(3)->minutes();
            [$own] = a20Start($email);

            for ($i = 0; $i < 5; $i++) {
                sr46Fresh();
                $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
                    ->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $own, 'code' => '000000', ...a20Device()]);
            }
        }

        sr46Fresh();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.7'])
            ->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => a20Attempt(), 'code' => '000000', ...a20Device()])
            ->assertStatus(429)->assertJsonPath('code', ErrorCode::EmailCodeLocked->value);

        // The owner, from elsewhere, asks for a code and signs in.
        $this->travel(3)->minutes();
        sr46Fresh();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20']);
        [$attempt, $code] = a20Start($email);
        sr46Fresh();
        $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertOk();
    });

    it('keeps the code budgets of the purposes apart', function () {
        [, $token] = a20Passwordless();
        $this->travel(3)->minutes();

        // Someone asks for sign-in codes for this address until its hourly budget is gone.
        for ($i = 0; $i < 6; $i++) {
            $this->travel(3)->minutes();
            sr46Fresh();
            $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);
        }

        $before = Mail::sent(EmailCodeMail::class)->count();
        sr46Fresh();
        $this->withToken($token)->postJson('/api/v1/me/reauth/email', ['attempt_id' => a20Attempt()])->assertSuccessful();

        expect(Mail::sent(EmailCodeMail::class)->count())->toBe($before + 1)
            ->and(Mail::sent(EmailCodeMail::class)->last()?->purpose)->toBe(LoginPurpose::Reauth);
    });
});

describe('SEC-M46-05 server nonces', function () {
    it('issues single-use nonces per provider behind its flag', function () {
        $nonce = $this->postJson('/api/v1/auth/nonce', ['provider' => 'google'])->assertCreated()->assertJsonPath('data.expires_in', 600)->json('data.nonce');
        expect($nonce)->toBeString()->toHaveLength(43);

        $this->postJson('/api/v1/auth/nonce', ['provider' => 'yahoo'])->assertStatus(422)->assertJsonValidationErrors('provider');
        a20Flag('auth.apple', false);
        $this->postJson('/api/v1/auth/nonce', ['provider' => 'apple'])->assertNotFound()->assertJsonPath('code', ErrorCode::FeatureDisabled->value);
    });

    it('refuses a Google token without a nonce of ours, of the other provider, or spent', function () {
        User::factory()->create(['email' => 'lena@beispiel.test']);
        $verifier = app(IdTokenVerifier::class);
        $refused = fn (Closure $call) => expect($call)->toThrow(fn (ApiException $e) => expect($e->errorCode)->toBe(ErrorCode::InvalidIdentityToken));

        // A nonce the server never issued.
        $refused(fn () => $verifier->verify(SocialProvider::Google, FakeIdTokens::google(['nonce' => 'made-up-by-the-client-123']), 'made-up-by-the-client-123'));

        // Issued for Apple.
        $apple = FakeIdTokens::serverNonce(SocialProvider::Apple);
        $refused(fn () => $verifier->verify(SocialProvider::Google, FakeIdTokens::google(['nonce' => $apple]), $apple));

        // Without one.
        $this->postJson('/api/v1/auth/google', ['id_token' => FakeIdTokens::google(['nonce' => null]), ...a20Device()])->assertStatus(422)->assertJsonValidationErrors('nonce');

        // Spent by the first token.
        $token = FakeIdTokens::google();
        $nonce = (string) FakeIdTokens::$lastNonce;
        $verifier->verify(SocialProvider::Google, $token, $nonce);
        $refused(fn () => $verifier->verify(SocialProvider::Google, $token, $nonce));
    });

    it('does not spend the nonce on a token that fails another check', function () {
        $nonce = FakeIdTokens::serverNonce(SocialProvider::Google);

        expect(fn () => app(IdTokenVerifier::class)->verify(SocialProvider::Google, FakeIdTokens::google(['nonce' => $nonce, 'aud' => 'someone-else']), $nonce))
            ->toThrow(ApiException::class);

        expect(app(IdTokenVerifier::class)->verify(SocialProvider::Google, FakeIdTokens::google(['nonce' => $nonce]), $nonce)->subject)->not->toBe('');
    });
});

describe('SEC-M46-06 JWKS outage', function () {
    it('keeps the last good key set while the provider is down and asks it at most once a minute', function () {
        $verifier = app(IdTokenVerifier::class);
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        expect(FakeIdTokens::$jwksRequests)->toBe(1);

        // The fresh copy expires and the provider fails.
        $this->travel(7)->hours();
        FakeIdTokens::$jwksDown = true;

        expect($verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce)->subject)->toBe('109876543210987654321');
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        expect(FakeIdTokens::$jwksRequests)->toBe(2);

        $this->travel(2)->minutes();
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        expect(FakeIdTokens::$jwksRequests)->toBe(3);

        // Back up: the fresh copy is fetched again.
        FakeIdTokens::$jwksDown = false;
        $this->travel(2)->minutes();
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        expect(FakeIdTokens::$jwksRequests)->toBe(4);
    });

    it('answers 503 without a last good key set', function () {
        FakeIdTokens::$jwksDown = true;

        expect(fn () => app(IdTokenVerifier::class)->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce))
            ->toThrow(fn (ApiException $e) => expect($e->errorCode)->toBe(ErrorCode::ServiceUnavailable));
    });
});
