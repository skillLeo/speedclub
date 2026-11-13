<?php

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use App\Mail\EmailCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Auth\IdTokens\IdTokenVerifier;
use App\Services\Auth\TwoFactor;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;
use Tests\Support\FakeIdTokens;

require_once __DIR__.'/Helpers.php';

/**
 * 09 §8.1 Apple and Google ID tokens (ADR-408) against a local fake JWKS: every claim check, the JWKS cache and its refetch, the
 * flags, and the takeover-safe linking of AUTH-16.
 */
const A20_NONCE = 'raw-nonce-0123456789abcdef';

beforeEach(function () {
    Mail::fake();
    Cache::flush();
    FakeIdTokens::install(['test-kid']);
    a20Flag('auth.apple');
    a20Flag('auth.google');
});

describe('IdTokenVerifier', function () {
    it('accepts a valid Apple token and reads its identity', function () {
        $identity = app(IdTokenVerifier::class)->verify(SocialProvider::Apple, FakeIdTokens::apple(FakeIdTokens::serverNonce(SocialProvider::Apple)), FakeIdTokens::$lastNonce);

        expect($identity->subject)->toBe('001234.abcdef0123456789.1234')
            ->and($identity->email)->toBe('lena@beispiel.test')
            ->and($identity->emailVerified)->toBeTrue()
            ->and($identity->privateRelay)->toBeFalse()
            ->and($identity->audience)->toBe(FakeIdTokens::APPLE_AUD);
    });

    it('accepts a valid Google token with either issuer spelling', function (string $iss) {
        $identity = app(IdTokenVerifier::class)->verify(SocialProvider::Google, FakeIdTokens::google(['iss' => $iss]), FakeIdTokens::$lastNonce);

        expect($identity->subject)->toBe('109876543210987654321');
    })->with(['https://accounts.google.com', 'accounts.google.com']);

    it('refuses every broken token with 401 invalid_identity_token', function (SocialProvider $provider, Closure $token, ?string $nonce) {
        expect(fn () => app(IdTokenVerifier::class)->verify($provider, $token(), $nonce ?? FakeIdTokens::$lastNonce))
            ->toThrow(fn (ApiException $e) => expect($e->errorCode)->toBe(ErrorCode::InvalidIdentityToken));
    })->with([
        'wrong aud' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['aud' => 'com.example.other']), A20_NONCE],
        'wrong iss' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['iss' => 'https://evil.example']), A20_NONCE],
        'google iss on apple' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['iss' => 'https://accounts.google.com']), A20_NONCE],
        'expired' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['exp' => time() - 400, 'iat' => time() - 1000]), A20_NONCE],
        'no exp' => [SocialProvider::Google, fn () => FakeIdTokens::google(['exp' => null]), null],
        'iat far ahead' => [SocialProvider::Google, fn () => FakeIdTokens::google(['iat' => time() + 900]), null],
        'iat too old' => [SocialProvider::Google, fn () => FakeIdTokens::google(['iat' => time() - 7200, 'exp' => time() + 600]), null],
        'alg none' => [SocialProvider::Google, fn () => FakeIdTokens::unsigned(['iss' => 'https://accounts.google.com', 'aud' => FakeIdTokens::GOOGLE_AUD, 'exp' => time() + 600, 'iat' => time(), 'sub' => '1', 'email' => 'a@b.test', 'email_verified' => true]), null],
        'HS256 with the public key' => [SocialProvider::Google, fn () => FakeIdTokens::google([], 'test-kid', 'HS256'), null],
        'RS512' => [SocialProvider::Google, fn () => FakeIdTokens::google([], 'test-kid', 'RS512'), null],
        'unknown kid' => [SocialProvider::Google, fn () => FakeIdTokens::google([], 'other-kid'), null],
        'nonce mismatch (apple)' => [SocialProvider::Apple, fn () => FakeIdTokens::apple('another-raw-nonce-xyz'), A20_NONCE],
        'raw nonce in the token (apple)' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['nonce' => A20_NONCE]), A20_NONCE],
        'no nonce (apple)' => [SocialProvider::Apple, fn () => FakeIdTokens::apple(A20_NONCE, ['nonce' => null]), A20_NONCE],
        'nonce mismatch (google)' => [SocialProvider::Google, fn () => FakeIdTokens::google(['nonce' => 'not-the-one-0123456']), 'raw-nonce-google-0123'],
        'unverified e-mail (google)' => [SocialProvider::Google, fn () => FakeIdTokens::google(['email_verified' => false]), null],
        'no e-mail (google)' => [SocialProvider::Google, fn () => FakeIdTokens::google(['email' => null]), null],
        'no subject' => [SocialProvider::Google, fn () => FakeIdTokens::google(['sub' => null]), null],
        'garbage' => [SocialProvider::Google, fn () => 'not.a.jwt', null],
        'tampered payload' => [SocialProvider::Google, function () {
            [$h, , $s] = explode('.', FakeIdTokens::google());

            return $h.'.'.rtrim(strtr(base64_encode((string) json_encode(['iss' => 'https://accounts.google.com', 'aud' => FakeIdTokens::GOOGLE_AUD, 'exp' => time() + 600, 'iat' => time(), 'sub' => 'attacker', 'email' => 'x@y.test', 'email_verified' => true])), '+/', '-_'), '=').'.'.$s;
        }, null],
    ]);

    it('caches the JWKS and fetches it again only for an unknown kid, at most once a minute', function () {
        $verifier = app(IdTokenVerifier::class);
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        $verifier->verify(SocialProvider::Google, FakeIdTokens::google(), FakeIdTokens::$lastNonce);
        expect(FakeIdTokens::$jwksRequests)->toBe(1);

        foreach (range(1, 3) as $i) {
            try {
                $verifier->verify(SocialProvider::Google, FakeIdTokens::google([], 'rotated-kid'), FakeIdTokens::$lastNonce);
            } catch (ApiException) {
            }
        }

        expect(FakeIdTokens::$jwksRequests)->toBe(2);
    });

    it('treats a missing client ID as switched off', function () {
        config(['services.google.client_ids' => []]);

        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])
            ->assertNotFound()->assertJsonPath('code', ErrorCode::FeatureDisabled->value);
    });
});

describe('POST auth/apple and auth/google', function () {
    it('are off behind their flags', function (string $uri, string $flag) {
        a20Flag($flag, false);

        $this->postJson($uri, [])->assertNotFound()->assertJsonPath('code', ErrorCode::FeatureDisabled->value);
    })->with([['/api/v1/auth/apple', 'auth.apple'], ['/api/v1/auth/google', 'auth.google']]);

    it('creates a new pending_terms account from Apple, with the name Apple sends once', function () {
        $this->postJson('/api/v1/auth/apple', ['identity_token' => FakeIdTokens::apple(FakeIdTokens::serverNonce(SocialProvider::Apple)), 'raw_nonce' => FakeIdTokens::$lastNonce, 'full_name' => 'Lena Kraft', ...a20Device('iPhone 16')])
            ->assertOk()
            ->assertJsonPath('data.is_new', true)
            ->assertJsonPath('data.next', 'terms')
            ->assertJsonPath('data.member.display_name', 'Lena Kraft');

        $user = User::query()->where('email', 'lena@beispiel.test')->sole();
        $account = SocialAccount::query()->sole();

        expect($account->user_id)->toBe($user->id)
            ->and($account->provider)->toBe(SocialProvider::Apple)
            ->and($account->getAttribute('refresh_token_encrypted'))->toBeNull()
            ->and($user->isPendingTerms())->toBeTrue()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::ProviderLinked->value)->exists())->toBeTrue();
        // The first way in of a new account is no change: no security mail.
        Mail::assertNotSent(SecurityNoticeMail::class);
    });

    it('accepts an Apple private relay address and marks it', function () {
        $this->postJson('/api/v1/auth/apple', ['identity_token' => FakeIdTokens::apple(FakeIdTokens::serverNonce(SocialProvider::Apple), ['email' => 'abc123@privaterelay.appleid.com', 'is_private_email' => 'true']), 'raw_nonce' => FakeIdTokens::$lastNonce, ...a20Device('iPhone 16')])
            ->assertOk();

        expect(SocialAccount::query()->sole()->getAttribute('is_private_relay'))->toBeTrue();
    });

    it('signs a linked subject in, skipping two-factor once the link was tied to it (SEC-M46-02)', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        $user->forceFill(['two_factor_secret' => app(TwoFactor::class)->newSecret(), 'two_factor_confirmed_at' => now()])->save();
        SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => SocialProvider::Google, 'provider_sub' => '109876543210987654321', 'second_factor_at' => now()]);

        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])
            ->assertOk()
            ->assertJsonPath('data.is_new', false)
            ->assertJsonPath('data.member.id', $user->id)
            ->assertJsonMissingPath('data.two_factor_required');
    });

    it('never links an existing verified account by address: AUTH-16 sends a code to that address', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);

        $response = $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])
            ->assertStatus(202)
            ->assertJsonPath('data.link_required', true)
            ->assertJsonPath('data.provider', 'google')
            ->assertJsonPath('data.email_hint', 'l•••@beispiel.test')
            ->assertJsonMissingPath('data.token');

        expect(SocialAccount::query()->count())->toBe(0);
        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail) => $mail->hasTo('lena@beispiel.test') && $mail->purpose === LoginPurpose::Link && $mail->provider === SocialProvider::Google);

        $attempt = (string) $response->json('data.attempt_id');
        $code = (string) a20LastCode()->code;

        $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => $attempt, 'code' => a20Other($code), ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_code');
        expect(SocialAccount::query()->count())->toBe(0);

        $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id)->assertJsonPath('data.is_new', false);

        expect(SocialAccount::query()->sole()->user_id)->toBe($user->id);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail) => $mail->notice === SecurityNotice::ProviderLinked);

        // Spent: a replay does nothing.
        $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => $attempt, 'code' => $code, ...a20Device()])->assertStatus(422);

        // Next time the subject signs in directly.
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])->assertOk()->assertJsonPath('data.member.id', $user->id);
    });

    it('answers an unknown link attempt like a wrong code', function () {
        $this->postJson('/api/v1/auth/link/confirm', ['attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_code');
    });

    it('links an unverified account of the address after proving it (ADR-135)', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test', 'email_verified_at' => null]);

        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])->assertOk()->assertJsonPath('data.member.id', $user->id);

        expect($user->refresh()->hasVerifiedEmail())->toBeTrue()->and($user->hasPassword())->toBeFalse();
    });

    it('refuses a closed account', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        $user->forceFill(['deletion_requested_at' => now()])->save();

        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(), ...a20Device()])
            ->assertUnauthorized()->assertJsonPath('code', ErrorCode::InvalidIdentityToken->value);
    });

    it('validates the body', function () {
        $this->postJson('/api/v1/auth/apple', [...a20Device()])->assertStatus(422)->assertJsonValidationErrors(['identity_token', 'raw_nonce']);
        $this->postJson('/api/v1/auth/google', [...a20Device()])->assertStatus(422)->assertJsonValidationErrors(['id_token']);
    });

    it('answers a refused token with 401 at the endpoint', function () {
        $this->postJson('/api/v1/auth/google', [...FakeIdTokens::googleInput(['aud' => 'x']), ...a20Device()])
            ->assertUnauthorized()->assertJsonPath('code', ErrorCode::InvalidIdentityToken->value);
    });

    it('limits provider sign-ins per IP', function () {
        foreach (range(1, 20) as $i) {
            $this->postJson('/api/v1/auth/google', ['id_token' => 'x.y.z', ...a20Device()]);
        }

        $this->postJson('/api/v1/auth/google', ['id_token' => 'x.y.z', ...a20Device()])->assertStatus(429);
    });
});
