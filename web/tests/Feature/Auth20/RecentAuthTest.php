<?php

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SocialProvider;
use App\Http\Middleware\RequireRecentAuthentication;
use App\Mail\EmailCodeMail;
use App\Models\AuditEvent;
use App\Models\LoginAttempt;
use App\Models\MemberPasskey;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Auth\TwoFactor;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\FakeIdTokens;

require_once __DIR__.'/Helpers.php';

/**
 * 09 §8.1 "sudo mode": POST me/reauth (password, e-mail code, passkey in PasskeyTest), the RequireRecentAuthentication middleware on the
 * listed endpoints, the legacy password path, linked providers and what the deletion removes.
 */
beforeEach(function () {
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
});

describe('RequireRecentAuthentication', function () {
    it('sits on every sensitive endpoint of 09 §8.1', function (string $name, bool $orPassword) {
        $route = Route::getRoutes()->getByName($name);
        $middleware = array_filter($route?->gatherMiddleware() ?? [], is_string(...));

        expect($middleware)->toContain(RequireRecentAuthentication::class.($orPassword ? ':10,or-password' : ':10'));
    })->with([
        'change e-mail' => ['api.v1.me.email.request', true],
        'set or change password' => ['api.v1.me.password', true],
        'add passkey (options)' => ['api.v1.me.passkeys.options', false],
        'add passkey' => ['api.v1.me.passkeys.store', false],
        'rename passkey' => ['api.v1.me.passkeys.update', false],
        'remove passkey' => ['api.v1.me.passkeys.destroy', false],
        'link provider' => ['api.v1.me.providers.store', false],
        'unlink provider' => ['api.v1.me.providers.destroy', false],
        'disable 2FA' => ['api.v1.me.two-factor.destroy', true],
        'revoke all sessions' => ['api.v1.me.sessions.destroy-others', true],
        'export data' => ['api.v1.me.exports.store', true],
        'delete account' => ['api.v1.me.delete', true],
    ]);

    it('counts a fresh sign-in as recent, a token older than 10 minutes not', function () {
        [$user, $token] = a20Passwordless();
        a20Flag('auth.passkeys');

        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk();

        $this->travel(11)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertForbidden()->assertJsonPath('code', ErrorCode::ReauthenticationRequired->value);
    });

    it('refuses a passwordless member without a recent proof on the legacy endpoints, lets a password holder send the password', function () {
        $passwordless = User::factory()->create();
        $passwordless->forceFill(['password' => null])->save();

        $this->withToken(a20OldToken($passwordless))->postJson('/api/v1/me/delete', [])
            ->assertForbidden()->assertJsonPath('code', ErrorCode::ReauthenticationRequired->value)->assertJsonPath('methods', ['email_code']);

        $this->app['auth']->forgetGuards();
        $holder = User::factory()->create();
        $this->withToken(a20OldToken($holder))->postJson('/api/v1/me/delete', ['password' => 'falsch-falsch-falsch'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->app['auth']->forgetGuards();
        $this->withToken(a20OldToken($holder))->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    });

    it('lets a recently proved passwordless member delete the account, which removes every way in', function () {
        [$user, $token] = a20Passwordless();
        MemberPasskey::factory()->create(['user_id' => $user->id]);
        SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-token']);

        $this->withToken($token)->postJson('/api/v1/me/delete', [])->assertNoContent();

        expect(MemberPasskey::query()->where('user_id', $user->id)->count())->toBe(0)
            ->and(SocialAccount::query()->where('user_id', $user->id)->count())->toBe(0)
            ->and(LoginAttempt::query()->where('user_id', $user->id)->count())->toBe(0)
            ->and($user->refresh()->isPendingDeletion())->toBeTrue()
            // Without the .p8 key the revoke is skipped, and that is recorded.
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::AppleRevoked->value)->value('after'))->toContain('skipped');
    });

    it('still checks a password that is sent within the window', function () {
        $user = User::factory()->create();
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->postJson('/api/v1/me/export', ['password' => 'falsch-falsch-falsch'])->assertStatus(422)->assertJsonValidationErrors('password');
    });
});

describe('POST me/reauth', function () {
    it('proves with the password', function () {
        $user = User::factory()->create();
        $token = a20OldToken($user);

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'falsch-falsch-falsch'])->assertStatus(422)->assertJsonValidationErrors('password');
        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'password'])->assertOk()->assertJsonStructure(['data' => ['reauthenticated_until']]);

        expect($user->tokens()->value('reauthenticated_at'))->not->toBeNull()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::Reauthenticated->value)->exists())->toBeTrue();
    });

    it('proves with an e-mail code of purpose reauth only', function () {
        $user = User::factory()->create(['email' => 'da@beispiel.test']);
        $token = a20OldToken($user);
        $attempt = a20Attempt();

        $this->withToken($token)->postJson('/api/v1/me/reauth/email', ['attempt_id' => $attempt])->assertStatus(202)->assertJsonPath('data.attempt_id', $attempt);
        $code = (string) a20LastCode()->code;
        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail) => $mail->hasTo('da@beispiel.test') && $mail->magicToken === null);

        // A sign-in code is not a reauth code.
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        [$signInAttempt, $signInCode] = a20Start('da@beispiel.test');
        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'email_code', 'attempt_id' => $signInAttempt, 'code' => $signInCode])->assertStatus(422);

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'email_code', 'attempt_id' => $attempt, 'code' => $code])->assertOk();
        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'email_code', 'attempt_id' => $attempt, 'code' => $code])->assertStatus(422);
    });

    it('needs the second factor for password and e-mail code when two-factor is on', function () {
        $user = User::factory()->create();
        $secret = app(TwoFactor::class)->newSecret();
        $user->forceFill(['two_factor_secret' => $secret, 'two_factor_confirmed_at' => now()])->save();
        $token = a20OldToken($user);

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'password'])->assertStatus(422)->assertJsonValidationErrors('two_factor_code');
        expect($user->tokens()->value('reauthenticated_at'))->toBeNull();

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'password', 'two_factor_code' => app(Google2FA::class)->getCurrentOtp($secret)])->assertOk();
    });

    it('refuses the password method for an account without one', function () {
        [, $token] = a20Passwordless();

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'irgendwas-langes'])->assertStatus(422)->assertJsonValidationErrors('password');
    });

    it('validates the method and its fields', function (array $body, array $fields) {
        $token = a20OldToken(User::factory()->create());

        $this->withToken($token)->postJson('/api/v1/me/reauth', $body)->assertStatus(422)->assertJsonValidationErrors($fields);
    })->with([
        'no method' => [[], ['method']],
        'unknown method' => [['method' => 'sms'], ['method']],
        'password without it' => [['method' => 'password'], ['password']],
        'e-mail code without code' => [['method' => 'email_code'], ['attempt_id', 'code']],
        'passkey without credential' => [['method' => 'passkey'], ['ceremony_id', 'credential']],
    ]);

    it('limits re-authentication per member and answers 401 to a guest', function () {
        $this->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'x'])->assertUnauthorized();
        $this->postJson('/api/v1/me/reauth/email', ['attempt_id' => a20Attempt()])->assertUnauthorized();
        $this->postJson('/api/v1/me/reauth/passkey-options')->assertUnauthorized();

        $token = a20OldToken(User::factory()->create());
        foreach (range(1, 10) as $i) {
            $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'falsch-falsch-'.$i]);
        }

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'password', 'password' => 'password'])->assertStatus(429);
    });
});

describe('me/providers', function () {
    beforeEach(function () {
        FakeIdTokens::install();
        a20Flag('auth.google');
        a20Flag('auth.apple');
    });

    it('lists, links and unlinks providers of the signed-in member', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput([], 'raw_nonce')])
            ->assertCreated()->assertJsonPath('data.provider', 'google')->assertJsonMissingPath('data.provider_sub');

        $this->withToken($token)->getJson('/api/v1/me/providers')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.email', 'lena@beispiel.test');

        $this->withToken($token)->deleteJson('/api/v1/me/providers/google')->assertNoContent();
        expect(SocialAccount::query()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::ProviderUnlinked->value)->exists())->toBeTrue();
    });

    it('refuses a subject of another account and a second ID of the same provider', function () {
        $owner = User::factory()->create();
        SocialAccount::factory()->create(['user_id' => $owner->id, 'provider' => SocialProvider::Google, 'provider_sub' => '109876543210987654321']);

        $user = User::factory()->create();
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput([], 'raw_nonce')])
            ->assertStatus(409)->assertJsonPath('code', ErrorCode::ProviderAlreadyLinked->value);

        SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => SocialProvider::Google, 'provider_sub' => 'another-sub']);
        $this->withToken($token)->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput(['sub' => 'third-sub'], 'raw_nonce')])->assertStatus(409);
    });

    it('keeps the last way in', function () {
        $user = User::factory()->create(['email' => 'abc@privaterelay.appleid.com']);
        $user->forceFill(['password' => null])->save();
        SocialAccount::factory()->apple()->create(['user_id' => $user->id]);
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->deleteJson('/api/v1/me/providers/apple')->assertStatus(409)->assertJsonPath('code', ErrorCode::LastSignInMethod->value);
        $this->withToken($token)->deleteJson('/api/v1/me/providers/google')->assertNotFound();
    });

    it('needs the flag, a recent proof, and a member', function () {
        $user = User::factory()->create();
        $token = a20OldToken($user);

        $this->withToken($token)->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput([], 'raw_nonce')])->assertForbidden();
        $this->withToken($token)->deleteJson('/api/v1/me/providers/google')->assertForbidden();

        $user->tokens()->update(['reauthenticated_at' => now()]);
        a20Flag('auth.google', false);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/me/providers', ['provider' => 'google', ...FakeIdTokens::googleInput([], 'raw_nonce')])->assertNotFound();

        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->getJson('/api/v1/me/providers')->assertUnauthorized();
    });
});
