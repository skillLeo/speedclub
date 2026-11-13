<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Mail\PasswordResetCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\FeatureFlag;
use App\Models\MemberPasskey;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\DeviceInstalls;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\VirtualAuthenticator;

/**
 * Gate for the security review of 532bb10 (M4.7, SEC-M47-01…05): the auditor's probes, each asserting the safe behaviour.
 */
const M47P_ORIGIN = 'https://speedclub.test';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    config([
        'app.url' => M47P_ORIGIN,
        'speedclub.passkeys.rp_id' => 'speedclub.test',
        'speedclub.passkeys.allowed_origins' => [],
        'speedclub.mobile.android_cert_sha256' => str_repeat('AB', 32),
        'speedclub.email_code.min_response_ms' => 0,
    ]);
    FeatureFlag::query()->updateOrCreate(['key' => 'auth.passkeys'], ['enabled' => true, 'description' => 'auth.passkeys']);
});

function m47pFresh(): void
{
    app('auth')->forgetGuards();
    test()->flushHeaders();
    test()->withHeader('Accept-Language', 'de');
}

function m47pLogin(User $user, string $install, string $name, string $password = 'password'): string
{
    $token = (string) test()->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => $password, 'device_name' => $name, 'platform' => 'android',
        'app_version' => '2.0.0', 'os_version' => '16', 'device_id' => $install,
    ])->assertOk()->json('data.token');
    m47pFresh();

    return $token;
}

function m47pSecureToken(): string
{
    $mail = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->secureUrl !== null)->last();

    return (string) Str::after((string) $mail->secureUrl, '#t=');
}

it('SEC-M47-01: "Das war ich nicht" plus the forced reset evicts a passkey the intruder added', function () {
    $owner = User::factory()->create(['email' => 'owner@beispiel.test']);
    m47pLogin($owner, 'install-owner-0001', 'Pixel 9');

    // Intruder with the phished password: new install, fresh sign-in counts as recent auth.
    $intruder = m47pLogin($owner, 'install-evil-0001', 'Galaxy S25');
    $link = m47pSecureToken();

    $authenticator = new VirtualAuthenticator;
    $options = $this->withToken($intruder)->postJson('/api/v1/me/passkeys/options')->assertOk()->json('data');
    $this->withToken($intruder)->postJson('/api/v1/me/passkeys', [
        'ceremony_id' => $options['ceremony_id'], 'credential' => $authenticator->register($options['options'], M47P_ORIGIN), 'name' => 'x',
    ])->assertCreated();
    m47pFresh();

    // Owner reacts to the alert mail.
    $this->postJson('/api/v1/auth/secure-account', ['token' => $link])->assertOk()->assertJsonPath('data.password_reset_required', true);
    m47pFresh();

    // Owner follows the instructions: sign in -> 403 + reset code -> new password.
    $this->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'platform' => 'android', 'device_id' => 'install-owner-0001'])->assertStatus(403);
    m47pFresh();
    $code = Mail::sent(PasswordResetCodeMail::class)->last()->code;
    $this->postJson('/api/v1/auth/password/reset', ['email' => $owner->email, 'code' => $code, 'password' => 'Ganz-Neues-Passwort-91'])->assertOk();
    m47pFresh();

    $mailsBefore = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::NewDevice)->count();

    // Intruder comes back with the passkey from the same install.
    $signIn = $this->postJson('/api/v1/auth/passkeys/options')->assertOk()->json('data');
    m47pFresh();
    $response = $this->postJson('/api/v1/auth/passkeys/verify', [
        'ceremony_id' => $signIn['ceremony_id'], 'credential' => $authenticator->assert($signIn['options'], M47P_ORIGIN),
        'device_name' => 'Galaxy S25', 'device_id' => 'install-evil-0001', 'platform' => 'android', 'app_version' => '2.0.0',
    ]);

    expect($response->status())->not->toBe(200);
});

it('SEC-M47-02: a browser sign-in with another version of the owner\'s browser raises the login alert', function () {
    config(['session.driver' => 'database']);
    app()->forgetInstance('session.store');
    $owner = User::factory()->create(['email' => 'owner2@beispiel.test']);
    $origin = 'http://localhost:8080';

    $browser = function (string $ua) use ($origin, $owner) {
        app('auth')->forgetGuards();
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');
        $cookie = test()->withHeaders(['Origin' => $origin, 'User-Agent' => $ua])->get('/sanctum/csrf-cookie')->getCookie(config()->string('session.cookie'))->getValue();
        app('auth')->forgetGuards();
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');

        return test()->withCredentials()->withCookie(config()->string('session.cookie'), $cookie)
            ->withHeaders(['Origin' => $origin, 'Accept' => 'application/json', 'User-Agent' => $ua])
            ->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password']);
    };

    // The owner once used the member web on Chrome 141 / Windows, and the app.
    m47pLogin($owner, 'install-owner-0002', 'Pixel 9');
    $browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')->assertOk();
    $alerts = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::NewDevice)->count();

    // The intruder (phishing kit logged the UA, or just the most common desktop UA) signs in from their own machine.
    $browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36')->assertOk();

    $after = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::NewDevice)->count();

    expect($after)->toBe($alerts + 1);
});

it('SEC-M47-03: the raw install id is not stored next to its hash, and two accounts of one phone do not share a value', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    m47pLogin($a, 'install-shared-0001', 'Pixel 9');
    m47pLogin($b, 'install-shared-0001', 'Pixel 9');

    $hashes = DB::table('device_installs')->pluck('install_id_hash')->unique();
    $raw = PersonalAccessToken::query()->pluck('device_id')->all();

    expect($raw)->not->toContain('install-shared-0001')->and($hashes->count())->toBe(2);
});

it('SEC-M47-04: securing the account ends an intruder-enabled second factor or tells the owner', function () {
    // Code-reading companion: SecureAccount::handle never touches two_factor_* columns.
    $src = file_get_contents(base_path('app/Actions/Security/SecureAccount.php'));
    expect($src)->toContain('two_factor');
});

it('SEC-M47-05: the intruder cannot void the owner\'s "Das war ich nicht" link by signing the owner out', function (string $how) {
    $owner = User::factory()->create(['email' => 'owner5@beispiel.test']);
    m47pLogin($owner, 'install-owner-0005', 'Pixel 9');
    $intruder = m47pLogin($owner, 'install-evil-0005', 'Galaxy S25');
    $link = m47pSecureToken();

    if ($how === 'sessions') {
        $this->withToken($intruder)->deleteJson('/api/v1/me/sessions')->assertNoContent();
    } else {
        $this->withToken($intruder)->postJson('/api/v1/me/password', ['current_password' => 'password', 'password' => 'Eindringling-Pw-4711', 'password_confirmation' => 'Eindringling-Pw-4711', 'revoke_other_sessions' => true])->assertNoContent();
    }
    m47pFresh();

    $response = $this->postJson('/api/v1/auth/secure-account', ['token' => $link]);
    m47pFresh();

    expect($response->status())->toBe(200);
})->with(['sessions', 'password']);

describe('SEC-M47-01 what securing removes', function () {
    it('removes passkeys, provider links and a second factor added since the reported sign-in, cancels an e-mail change and lists it all', function () {
        $owner = User::factory()->create(['email' => 'owner6@beispiel.test', 'locale' => 'de']);
        $earlier = MemberPasskey::factory()->create(['user_id' => $owner->id, 'created_at' => now()->subDays(30)]);
        $earlierLink = SocialAccount::factory()->create(['user_id' => $owner->id, 'created_at' => now()->subDays(30)]);
        m47pLogin($owner, 'install-owner-0006', 'Pixel 9');
        $this->travel(1)->minutes();
        m47pLogin($owner, 'install-evil-0006', 'Galaxy S25');
        $link = m47pSecureToken();
        $this->travel(1)->minutes();

        MemberPasskey::factory()->create(['user_id' => $owner->id]);
        SocialAccount::factory()->apple()->create(['user_id' => $owner->id]);
        VerificationCode::factory()->create(['user_id' => $owner->id, 'purpose' => VerificationPurpose::EmailChange]);
        $owner->forceFill(['two_factor_secret' => 'JBSWY3DPEHPK3PXP', 'two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => ['a-b']])->save();

        $this->postJson('/api/v1/auth/secure-account', ['token' => $link])->assertOk()
            ->assertJsonPath('data.removed', ['passkeys' => 1, 'providers' => 1, 'email_change' => true, 'two_factor' => true]);

        $owner->refresh();
        expect(MemberPasskey::query()->where('user_id', $owner->id)->pluck('id')->all())->toBe([$earlier->id])
            ->and(SocialAccount::query()->where('user_id', $owner->id)->pluck('id')->all())->toBe([$earlierLink->id])
            ->and(VerificationCode::query()->where('user_id', $owner->id)->where('purpose', VerificationPurpose::EmailChange)->exists())->toBeFalse()
            ->and($owner->hasTwoFactor())->toBeFalse();

        $ticket = SupportTicket::query()->where('user_id', $owner->id)->sole();
        expect((string) $ticket->messages()->value('body'))->toContain('1 Passkey')->toContain('offene E-Mail-Änderung')->toContain('Zwei-Faktor-Schutz');

        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::AccountSecured
            && str_contains($mail->render(), '1 verbundenes Konto'));
    });

    it('keeps a second factor that was on before the reported sign-in', function () {
        $owner = User::factory()->create(['email' => 'owner7@beispiel.test']);
        $owner->forceFill(['two_factor_secret' => 'JBSWY3DPEHPK3PXP', 'two_factor_confirmed_at' => now()->subMonth(), 'two_factor_recovery_codes' => ['a-b']])->save();
        $event = SecurityEvent::factory()->create(['user_id' => $owner->id, 'type' => MemberSecurityEvent::LoginNewDevice]);
        Sanctum::actingAs($owner);

        $this->postJson('/api/v1/me/security/secure', ['event_id' => $event->id])->assertOk()->assertJsonPath('data.removed.two_factor', false);
        expect($owner->fresh()->hasTwoFactor())->toBeTrue();
    });
});

describe('SEC-M47-05 / -07 the alert link', function () {
    it('works once: a second use, also of another open link of the account, is 422', function () {
        $owner = User::factory()->create(['email' => 'owner8@beispiel.test']);
        m47pLogin($owner, 'install-owner-0008', 'Pixel 9');
        m47pLogin($owner, 'install-evil-0008', 'Galaxy S25');
        $first = m47pSecureToken();
        $this->travel(2)->hours();
        m47pLogin($owner, 'install-evil-0009', 'Galaxy S24');
        $second = m47pSecureToken();
        expect($second)->not->toBe($first);

        $this->postJson('/api/v1/auth/secure-account', ['token' => $first])->assertOk();
        $this->postJson('/api/v1/auth/secure-account', ['token' => $first])->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/api/v1/auth/secure-account', ['token' => $second])->assertUnprocessable()->assertJsonValidationErrors('token');
    });

    it('expires after the link window', function () {
        $owner = User::factory()->create(['email' => 'owner9@beispiel.test']);
        m47pLogin($owner, 'install-owner-0010', 'Pixel 9');
        m47pLogin($owner, 'install-evil-0010', 'Galaxy S25');
        $link = m47pSecureToken();
        $this->travel(config()->integer('speedclub.security_events.secure_link_days') + 1)->days();

        $this->postJson('/api/v1/auth/secure-account', ['token' => $link])->assertUnprocessable();
    });

    it('puts a fresh link into the password-changed mail, and none into one about a change staff made', function () {
        $owner = User::factory()->create(['email' => 'owner10@beispiel.test']);
        $token = m47pLogin($owner, 'install-owner-0011', 'Pixel 9');

        $this->withToken($token)->postJson('/api/v1/me/password', ['current_password' => 'password', 'password' => 'Neues-Passwort-4711', 'password_confirmation' => 'Neues-Passwort-4711'])->assertNoContent();
        m47pFresh();

        $mail = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::PasswordChanged)->last();
        expect($mail->secureUrl)->toContain('/auth/secure#t=');

        $this->postJson('/api/v1/auth/secure-account', ['token' => Str::after((string) $mail->secureUrl, '#t=')])->assertOk();

        $owner = $owner->fresh();
        SecurityEvent::factory()->create(['user_id' => $owner->id, 'type' => MemberSecurityEvent::LogoutAll]);
        expect((fn () => $this->freshSecureUrl($owner, SecurityNotice::SessionsRevoked, 'staff'))->call(app(Notifier::class)))->toBeNull()
            ->and((fn () => $this->freshSecureUrl($owner, SecurityNotice::SessionsRevoked, null))->call(app(Notifier::class)))->toContain('/auth/secure#t=');
    });
});

describe('SEC-M47-02 browser id', function () {
    it('knows a browser again by its cookie, whatever its version, and sets the cookie HttpOnly', function () {
        config(['session.driver' => 'database']);
        app()->forgetInstance('session.store');
        $owner = User::factory()->create(['email' => 'owner11@beispiel.test']);
        m47pLogin($owner, 'install-owner-0012', 'Pixel 9');
        $name = config()->string('speedclub.known_devices.browser_cookie');

        $browser = function (string $ua, ?string $browserId = null) use ($owner) {
            app('auth')->forgetGuards();
            app('session')->forgetDrivers();
            app()->forgetInstance('session.store');
            $session = test()->withHeaders(['Origin' => 'http://localhost:8080', 'User-Agent' => $ua])->get('/sanctum/csrf-cookie')->getCookie(config()->string('session.cookie'))->getValue();
            app('auth')->forgetGuards();
            app('session')->forgetDrivers();
            app()->forgetInstance('session.store');
            $request = test()->withCredentials()->withCookie(config()->string('session.cookie'), $session);

            if ($browserId !== null) {
                $request = $request->withCookie(config()->string('speedclub.known_devices.browser_cookie'), $browserId);
            }

            return $request->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json', 'User-Agent' => $ua])
                ->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password']);
        };

        $first = $browser('Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36')->assertOk();
        $cookie = $first->getCookie($name);
        expect($cookie)->not->toBeNull()->and($cookie->isHttpOnly())->toBeTrue()->and($cookie->getSameSite())->toBe('lax');
        $alerts = Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::NewDevice)->count();

        $browser('Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36', $cookie->getValue())->assertOk();

        expect(Mail::sent(SecurityNoticeMail::class, fn (SecurityNoticeMail $m): bool => $m->notice === SecurityNotice::NewDevice)->count())->toBe($alerts);
    });
});

describe('SEC-M47-03 keyed install ids', function () {
    it('ends the previous member\'s push token on a phone when another member signs in there', function () {
        $first = User::factory()->create();
        $second = User::factory()->create();
        $token = m47pLogin($first, 'install-shared-0002', 'Pixel 9');
        $this->withToken($token)->postJson('/api/v1/me/push-tokens', ['token' => 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]', 'platform' => 'android', 'device_id' => 'install-shared-0002'])->assertNoContent();
        m47pFresh();

        $row = PushToken::query()->sole();
        expect($row->getAttribute('device_id'))->toBe(DeviceInstalls::key($first->id, 'install-shared-0002'))
            ->and($row->getAttribute('install_key'))->toBe(DeviceInstalls::installKey('install-shared-0002'));

        m47pLogin($second, 'install-shared-0002', 'Pixel 9');

        expect(PushToken::query()->count())->toBe(0);
    });

    it('refuses a push registration for another install and removes one by its raw id', function () {
        $member = User::factory()->create();
        $token = m47pLogin($member, 'install-own-00001', 'Pixel 9');

        $this->withToken($token)->postJson('/api/v1/me/push-tokens', ['token' => 'ExponentPushToken[cccccccccccccccccccccc]', 'platform' => 'android', 'device_id' => 'install-other-0001'])->assertUnprocessable();
        $this->withToken($token)->postJson('/api/v1/me/push-tokens', ['token' => 'ExponentPushToken[cccccccccccccccccccccc]', 'platform' => 'android', 'device_id' => 'install-own-00001'])->assertNoContent();
        $this->withToken($token)->deleteJson('/api/v1/me/push-tokens/install-own-00001')->assertNoContent();

        expect(PushToken::query()->count())->toBe(0);
    });
});

describe('SEC-M47-03 / -08 data migration', function () {
    it('rekeys raw install ids and marks backfilled staff rows', function () {
        $member = User::factory()->create();
        $token = $member->createToken('Pixel 9')->accessToken;
        $token->forceFill(['device_id' => 'install-raw-00001'])->save();
        DB::table('device_installs')->insert(['id' => strtolower((string) Str::ulid()), 'user_id' => $member->id, 'install_id_hash' => DeviceInstalls::legacyHash('install-raw-00001'), 'first_seen_at' => now(), 'last_seen_at' => now()]);
        DB::table('known_devices')->insert(['id' => strtolower((string) Str::ulid()), 'user_id' => $member->id, 'fingerprint' => hash('sha256', 'token-id|install-raw-00001'), 'last_seen_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        PushToken::factory()->create(['user_id' => $member->id, 'device_id' => 'install-raw-00001']);

        $at = now()->subDay()->startOfSecond();
        DB::table('audit_events')->insert(['occurred_at' => $at, 'actor_type' => 'staff', 'actor_id' => '1', 'action' => MemberSecurityEvent::LogoutAll->value, 'target_type' => 'user', 'target_id' => $member->id, 'hash' => str_repeat('a', 64), 'prev_hash' => str_repeat('0', 64)]);
        $event = SecurityEvent::factory()->create(['user_id' => $member->id, 'type' => MemberSecurityEvent::LogoutAll, 'device_name' => 'Pixel 9', 'meta' => null, 'created_at' => $at]);

        $migration = require database_path('migrations/2026_11_29_200000_harden_account_security.php');
        (fn () => [$this->hashTokens(), $this->hashPushTokens(), $this->markStaffEvents()])->call($migration);

        $key = DeviceInstalls::key($member->id, 'install-raw-00001');
        expect($token->fresh()->getAttribute('device_id'))->toBe($key)
            ->and(DB::table('device_installs')->where('user_id', $member->id)->value('install_id_hash'))->toBe($key)
            ->and(DB::table('known_devices')->where('user_id', $member->id)->value('fingerprint'))->toBe(DeviceInstalls::fingerprint($member->id, 'install-raw-00001'))
            ->and(PushToken::query()->value('device_id'))->toBe($key)
            ->and($event->fresh()->meta)->toBe(['by_staff' => true])
            ->and($event->fresh()->device_name)->toBeNull();
    });
});
