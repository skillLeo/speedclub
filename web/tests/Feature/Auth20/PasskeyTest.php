<?php

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\MemberPasskey;
use App\Models\PasskeyChallenge;
use App\Models\User;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use App\Services\Auth\TwoFactor;
use Illuminate\Support\Facades\Mail;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Tests\Support\VirtualAuthenticator;

require_once __DIR__.'/Helpers.php';

/**
 * 09 §8.2 passkeys on web-auth/webauthn-lib (ADR-409), with ceremonies of a software authenticator (tests/Support/VirtualAuthenticator):
 * registration, usernameless sign-in, re-authentication, single-use 5-minute challenges, origins (https and android:apk-key-hash),
 * counter regression, the management endpoints and their authorisation matrix.
 */
const A20_ORIGIN = 'https://speedclub.test';

beforeEach(function () {
    Mail::fake();
    config([
        'app.url' => A20_ORIGIN,
        'speedclub.passkeys.rp_id' => 'speedclub.test',
        'speedclub.passkeys.allowed_origins' => [],
        'speedclub.mobile.android_cert_sha256' => str_repeat('AB', 32),
        'speedclub.email_code.min_response_ms' => 0,
    ]);
    a20Flag('auth.passkeys');
});

/**
 * Registers $authenticator for $token's member through the API and returns the stored passkey's id.
 */
function a20Register(string $token, VirtualAuthenticator $authenticator, ?string $name = null, string $origin = A20_ORIGIN): string
{
    $options = test()->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');

    return (string) test()->withToken($token)->postJson('/api/v1/me/passkeys', [
        'ceremony_id' => $options['ceremony_id'],
        'credential' => $authenticator->register($options['options'], $origin),
        'name' => $name,
    ])->assertCreated()->json('data.id');
}

/**
 * @return array{ceremony_id: string, options: array<string, mixed>}
 */
function a20SignInOptions(): array
{
    app('auth')->forgetGuards();

    return test()->flushHeaders()->postJson('/api/v1/auth/passkeys/options')->assertOk()->json('data');
}

describe('registration', function () {
    it('stores a passkey with its provider, transports and backup state, and mails the owner', function () {
        [$user, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;

        $options = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()
            ->assertJsonPath('data.expires_in', 300)
            ->assertJsonPath('data.options.rp.id', 'speedclub.test')
            ->assertJsonPath('data.options.authenticatorSelection.residentKey', 'required')
            ->assertJsonPath('data.options.authenticatorSelection.userVerification', 'required')
            ->assertJsonPath('data.options.attestation', 'none')
            ->json('data');

        // The user handle is opaque: neither the id nor the address.
        expect(Base64UrlSafe::decodeNoPadding($options['options']['user']['id']))->toBe(MemberWebAuthn::userHandle($user))->not->toContain($user->id);

        $this->withToken($token)->withHeader('Accept-Language', 'de')->postJson('/api/v1/me/passkeys', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->register($options['options'], A20_ORIGIN)])
            ->assertCreated()
            ->assertJsonPath('data.name', 'iCloud-Schlüsselbund')
            ->assertJsonPath('data.provider', 'iCloud-Schlüsselbund')
            ->assertJsonPath('data.provider_icon', 'apple')
            ->assertJsonPath('data.synced', true)
            ->assertJsonMissingPath('data.credential_id');

        $passkey = MemberPasskey::query()->sole();
        expect($passkey->user_id)->toBe($user->id)
            ->and($passkey->transports)->toBe(['internal', 'hybrid'])
            ->and($passkey->aaguid)->toBe(VirtualAuthenticator::AAGUID)
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::PasskeyAdded->value)->exists())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail) => $mail->notice === SecurityNotice::PasskeyAdded);
    });

    it('excludes the passkeys already stored and refuses the same credential twice', function () {
        [, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator, 'iPhone');

        $options = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');
        expect($options['options']['excludeCredentials'][0]['id'])->toBe(Base64UrlSafe::encodeUnpadded($authenticator->credentialId));

        $this->withToken($token)->postJson('/api/v1/me/passkeys', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->register($options['options'], A20_ORIGIN)])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::PasskeyInvalid->value);
    });

    it('accepts the Android app origin from the signing certificate and refuses a foreign one', function () {
        [, $token] = a20Passwordless();
        $android = 'android:apk-key-hash:'.Base64UrlSafe::encodeUnpadded((string) hex2bin(str_repeat('AB', 32)));

        a20Register($token, new VirtualAuthenticator, 'Pixel', $android);

        $options = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');
        $this->withToken($token)->postJson('/api/v1/me/passkeys', ['ceremony_id' => $options['ceremony_id'], 'credential' => (new VirtualAuthenticator)->register($options['options'], 'https://evil.example')])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::PasskeyInvalid->value);
    });

    it('spends a ceremony once and lets it expire after 5 minutes', function () {
        [, $token] = a20Passwordless();
        $options = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');
        $credential = (new VirtualAuthenticator)->register($options['options'], A20_ORIGIN);

        $this->travel(6)->minutes();
        $this->withToken($token)->postJson('/api/v1/me/passkeys', ['ceremony_id' => $options['ceremony_id'], 'credential' => $credential])->assertStatus(422);
        $this->travelBack();

        // A failed check still spends it.
        $fresh = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');
        $tampered = (new VirtualAuthenticator)->register($fresh['options'], A20_ORIGIN);
        $tampered['response']['clientDataJSON'] = Base64UrlSafe::encodeUnpadded((string) json_encode(['type' => 'webauthn.create', 'challenge' => 'AAAA', 'origin' => A20_ORIGIN]));
        $this->withToken($token)->postJson('/api/v1/me/passkeys', ['ceremony_id' => $fresh['ceremony_id'], 'credential' => $tampered])->assertStatus(422);
        expect(PasskeyChallenge::query()->whereKey($fresh['ceremony_id'])->value('consumed_at'))->not->toBeNull();
    });

    it('refuses another member\'s registration ceremony', function () {
        [, $token] = a20Passwordless();
        $options = $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');

        $other = User::factory()->create();
        $this->app['auth']->forgetGuards();
        $otherToken = a20OldToken($other);
        // Within the recent window of a fresh reauth.
        $other->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($otherToken)->postJson('/api/v1/me/passkeys', ['ceremony_id' => $options['ceremony_id'], 'credential' => (new VirtualAuthenticator)->register($options['options'], A20_ORIGIN)])
            ->assertStatus(422);
    });

    it('needs a recent authentication and the flag', function () {
        $user = User::factory()->create();
        $token = a20OldToken($user);

        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')
            ->assertForbidden()->assertJsonPath('code', ErrorCode::ReauthenticationRequired->value)->assertJsonPath('methods', ['email_code', 'password']);

        $user->tokens()->update(['reauthenticated_at' => now()]);
        a20Flag('auth.passkeys', false);
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertNotFound()->assertJsonPath('code', ErrorCode::FeatureDisabled->value);
    });

    it('validates the body', function () {
        [, $token] = a20Passwordless();

        $this->withToken($token)->postJson('/api/v1/me/passkeys', ['ceremony_id' => 'x'])->assertStatus(422)->assertJsonValidationErrors(['ceremony_id', 'credential']);
    });
});

describe('sign-in', function () {
    it('signs the owner in without a username, skipping two-factor', function () {
        [$user, $token] = a20Passwordless();
        $user->forceFill(['two_factor_secret' => app(TwoFactor::class)->newSecret(), 'two_factor_confirmed_at' => now()])->save();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);

        $options = a20SignInOptions();
        expect($options['options']['allowCredentials'] ?? [])->toBe([])
            ->and($options['options']['userVerification'])->toBe('required');

        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN), ...a20Device('iPhone 16', 'install-0002-bbbb')])
            ->assertOk()
            ->assertJsonPath('data.member.id', $user->id)
            ->assertJsonPath('data.is_new', false)
            ->assertJsonMissingPath('data.two_factor_required');

        expect(MemberPasskey::query()->sole()->sign_count)->toBe(1)
            ->and(MemberPasskey::query()->sole()->getAttribute('last_used_at'))->not->toBeNull();
    });

    it('refuses a replayed ceremony, a wrong RP and a bad signature', function () {
        [, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);

        $options = a20SignInOptions();
        $assertion = $authenticator->assert($options['options'], A20_ORIGIN);
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $assertion, ...a20Device()])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $assertion, ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::PasskeyInvalid->value);

        $options = a20SignInOptions();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN, rpId: 'evil.example'), ...a20Device()])
            ->assertStatus(422);

        $options = a20SignInOptions();
        $forged = $authenticator->assert($options['options'], A20_ORIGIN);
        $forged['response']['signature'] = Base64UrlSafe::encodeUnpadded(random_bytes(70));
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $forged, ...a20Device()])->assertStatus(422);
    });

    it('refuses a counter that went back, and reports it to the owner', function () {
        [$user, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);

        $options = a20SignInOptions();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN, counter: 5), ...a20Device()])->assertOk();

        $options = a20SignInOptions();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN, counter: 3), ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::PasskeyInvalid->value);

        expect(AuditEvent::query()->where('action', MemberSecurityEvent::PasskeySignCountRegressed->value)->where('target_id', $user->id)->exists())->toBeTrue()
            ->and(MemberPasskey::query()->sole()->sign_count)->toBe(5);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail) => $mail->notice === SecurityNotice::PasskeyRejected);
    });

    it('refuses an unknown credential and a closed account', function () {
        [$user, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);

        $options = a20SignInOptions();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => (new VirtualAuthenticator)->assert($options['options'], A20_ORIGIN), ...a20Device()])->assertStatus(422);

        $user->forceFill(['deletion_requested_at' => now()])->save();
        $options = a20SignInOptions();
        $this->postJson('/api/v1/auth/passkeys/verify', ['ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN), ...a20Device()])->assertStatus(422);
    });

    it('is off behind its flag and validates', function () {
        a20Flag('auth.passkeys', false);
        $this->postJson('/api/v1/auth/passkeys/options')->assertNotFound();

        a20Flag('auth.passkeys');
        $this->postJson('/api/v1/auth/passkeys/verify', [...a20Device()])->assertStatus(422)->assertJsonValidationErrors(['ceremony_id', 'credential']);
    });
});

describe('management', function () {
    it('lists, renames and deletes own passkeys', function () {
        [$user, $token] = a20Passwordless();
        $id = a20Register($token, new VirtualAuthenticator, 'Mein iPhone');

        $this->withToken($token)->getJson('/api/v1/me/passkeys')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Mein iPhone');
        $this->withToken($token)->patchJson("/api/v1/me/passkeys/$id", ['name' => 'Arbeitshandy'])->assertOk()->assertJsonPath('data.name', 'Arbeitshandy');
        $this->withToken($token)->deleteJson("/api/v1/me/passkeys/$id")->assertNoContent();

        expect(MemberPasskey::query()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::PasskeyRemoved->value)->exists())->toBeTrue();
    });

    it('hides another member\'s passkey behind 404', function (string $method) {
        $passkey = MemberPasskey::factory()->create();
        [, $token] = a20Passwordless();

        $this->withToken($token)->json($method, "/api/v1/me/passkeys/{$passkey->id}", ['name' => 'x'])->assertNotFound();
        expect(MemberPasskey::query()->whereKey($passkey->id)->value('name'))->toBe('iPhone');
    })->with(['PATCH', 'DELETE']);

    it('keeps the last way into an account', function () {
        $user = User::factory()->create(['email' => 'abc@privaterelay.appleid.com']);
        $user->forceFill(['password' => null])->save();
        $passkey = MemberPasskey::factory()->create(['user_id' => $user->id]);
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->deleteJson("/api/v1/me/passkeys/{$passkey->id}")->assertStatus(409)->assertJsonPath('code', ErrorCode::LastSignInMethod->value);
    });

    it('needs a recent authentication to rename or delete, not to list', function () {
        $user = User::factory()->create();
        $passkey = MemberPasskey::factory()->create(['user_id' => $user->id]);
        $token = a20OldToken($user);

        $this->withToken($token)->getJson('/api/v1/me/passkeys')->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($token)->patchJson("/api/v1/me/passkeys/{$passkey->id}", ['name' => 'x'])->assertForbidden()->assertJsonPath('code', ErrorCode::ReauthenticationRequired->value);
        $this->withToken($token)->deleteJson("/api/v1/me/passkeys/{$passkey->id}")->assertForbidden();
    });

    it('answers 401 to a guest on every passkey route', function (string $method, string $uri) {
        $this->json($method, $uri)->assertUnauthorized();
    })->with([
        ['GET', '/api/v1/me/passkeys'],
        ['POST', '/api/v1/me/passkeys/options'],
        ['POST', '/api/v1/me/passkeys'],
        ['PATCH', '/api/v1/me/passkeys/01JAAAAAAAAAAAAAAAAAAAAAAA'],
        ['DELETE', '/api/v1/me/passkeys/01JAAAAAAAAAAAAAAAAAAAAAAA'],
    ]);

    it('stays open to a restricted member and before AUTH-09b', function () {
        [$user, $token] = a20Passwordless(pendingTerms: true);
        $user->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();
        $this->app['auth']->forgetGuards();

        a20Register($token, new VirtualAuthenticator);
        expect(MemberPasskey::query()->count())->toBe(1);
    });
});

describe('re-authentication with a passkey', function () {
    it('proves the member and opens the sensitive endpoints', function () {
        [$user, $token] = a20Passwordless();
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);
        $user->tokens()->update(['reauthenticated_at' => now()->subHour()]);
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertForbidden()->assertJsonPath('methods', ['passkey', 'email_code']);

        $options = $this->withToken($token)->postJson('/api/v1/me/reauth/passkey-options')->assertOk()->json('data');
        expect($options['options']['allowCredentials'][0]['id'])->toBe(Base64UrlSafe::encodeUnpadded($authenticator->credentialId));

        $this->withToken($token)->postJson('/api/v1/me/reauth', ['method' => 'passkey', 'ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN)])
            ->assertOk()->assertJsonPath('data.reauthenticated_until', fn (string $until) => abs(now()->addMinutes(10)->diffInSeconds($until)) < 5);

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->postJson('/api/v1/me/passkeys/options')->assertOk();
    });

    it('refuses another member\'s passkey', function () {
        [, $token] = a20Passwordless('a@beispiel.test');
        $authenticator = new VirtualAuthenticator;
        a20Register($token, $authenticator);

        $this->app['auth']->forgetGuards();
        [, $other] = a20Passwordless('b@beispiel.test');
        a20Register($other, new VirtualAuthenticator);
        $options = $this->withToken($other)->postJson('/api/v1/me/reauth/passkey-options')->assertOk()->json('data');

        $this->withToken($other)->postJson('/api/v1/me/reauth', ['method' => 'passkey', 'ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->assert($options['options'], A20_ORIGIN)])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::PasskeyInvalid->value);
    });
});

describe('platform files', function () {
    it('serves the passkey association of both platforms as application/json, without redirects', function () {
        config(['speedclub.mobile.ios_team_id' => 'ABCDE12345', 'speedclub.mobile.ios_bundle_id' => 'de.speedclub.app']);

        $aasa = $this->get('/.well-known/apple-app-site-association')->assertOk()->assertHeader('Content-Type', 'application/json');
        $links = $this->get('/.well-known/assetlinks.json')->assertOk()->assertHeader('Content-Type', 'application/json');

        expect($aasa->json('webcredentials.apps'))->toBe(['ABCDE12345.de.speedclub.app'])
            ->and($links->json('0.relation'))->toContain('delegate_permission/common.get_login_creds');
    });

    it('lists the magic link as an app path and lands browsers in the member web, keeping the fragment out of the server', function () {
        $this->get('/auth/magic')->assertRedirect('/app/auth/magic');
    });
});
