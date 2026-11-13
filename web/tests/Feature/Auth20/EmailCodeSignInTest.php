<?php

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\OnboardingState;
use App\Enums\SecurityNotice;
use App\Mail\AccountClosingMail;
use App\Mail\EmailCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Models\LoginAttempt;
use App\Models\User;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\TwoFactor;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/Helpers.php';

/**
 * 09 §8.1 e-mail code sign-in: start (enumeration-safe 202), verify (code or same-device magic link), new accounts pending_terms until
 * AUTH-09b, and the abuse suite (timing and body, cooldowns, hourly caps, attempts per code, reuse, expiry, lock + security mail).
 */
beforeEach(function () {
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
});

describe('POST auth/email/start', function () {
    it('answers the same 202 body for a known and an unknown address and mails the right code', function () {
        User::factory()->create(['email' => 'bekannt@beispiel.test']);
        $known = $this->postJson('/api/v1/auth/email/start', ['email' => 'bekannt@beispiel.test', 'attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa'])->assertStatus(202);
        $unknown = $this->postJson('/api/v1/auth/email/start', ['email' => 'fremd@beispiel.test', 'attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa'])->assertStatus(202);

        expect($known->json())->toBe($unknown->json())
            ->and($known->json())->toBe(['data' => ['attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa', 'resend_after' => 30]])
            ->and($known->headers->get('Cache-Control'))->toContain('no-store');

        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail) => $mail->hasTo('bekannt@beispiel.test') && ! $mail->newAccount && $mail->purpose === LoginPurpose::SignIn);
        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail) => $mail->hasTo('fremd@beispiel.test') && $mail->newAccount);
        expect(User::query()->where('email', 'fremd@beispiel.test')->exists())->toBeFalse();
    });

    it('takes at least the floor duration for a known and an unknown address', function () {
        config(['speedclub.email_code.min_response_ms' => 200]);
        User::factory()->create(['email' => 'bekannt@beispiel.test']);

        foreach (['bekannt@beispiel.test', 'fremd@beispiel.test'] as $email) {
            $started = hrtime(true);
            $this->postJson('/api/v1/auth/email/start', ['email' => $email, 'attempt_id' => a20Attempt()])->assertStatus(202);
            expect((hrtime(true) - $started) / 1e6)->toBeGreaterThanOrEqual(200);
        }
    });

    it('sends the account-closing notice instead of a code to a closed account', function () {
        $user = User::factory()->create(['email' => 'zu@beispiel.test']);
        $user->forceFill(['deletion_requested_at' => now()])->save();

        $this->postJson('/api/v1/auth/email/start', ['email' => 'zu@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);

        Mail::assertSent(AccountClosingMail::class);
        Mail::assertNotSent(EmailCodeMail::class);
    });

    it('validates the address and the attempt id', function (array $body, string $field) {
        $this->postJson('/api/v1/auth/email/start', $body)->assertStatus(422)->assertJsonValidationErrors($field);
    })->with([
        'no address' => [['attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa'], 'email'],
        'bad address' => [['email' => 'kein-at', 'attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa'], 'email'],
        'short attempt' => [['email' => 'a@beispiel.test', 'attempt_id' => 'kurz'], 'attempt_id'],
        'attempt with symbols' => [['email' => 'a@beispiel.test', 'attempt_id' => 'aaaaaaaaaaaaaaaaaaaaa/aaaa'], 'attempt_id'],
        'bad locale' => [['email' => 'a@beispiel.test', 'attempt_id' => 'aaaaaaaaaaaaaaaaaaaaaaaaaa', 'locale' => 'fr'], 'locale'],
    ]);

    it('holds the cooldowns 30 → 60 → 120 s and sends nothing inside them', function () {
        $start = fn () => $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202)->json('data.resend_after');

        expect($start())->toBe(30);
        expect($start())->toBe(30);
        Mail::assertSent(EmailCodeMail::class, 1);

        $this->travel(31)->seconds();
        expect($start())->toBe(60);
        $this->travel(61)->seconds();
        expect($start())->toBe(120);
        $this->travel(121)->seconds();
        expect($start())->toBe(120);
        Mail::assertSent(EmailCodeMail::class, 4);
    });

    it('sends at most 5 codes an hour to one address', function () {
        foreach (range(1, 7) as $i) {
            $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);
            $this->travel(121)->seconds();
        }

        Mail::assertSent(EmailCodeMail::class, 5);
    });

    it('limits starts to 20 an hour per IP', function () {
        foreach (range(1, 20) as $i) {
            $this->postJson('/api/v1/auth/email/start', ['email' => "p$i@beispiel.test", 'attempt_id' => a20Attempt()])->assertStatus(202);
        }

        $this->postJson('/api/v1/auth/email/start', ['email' => 'p21@beispiel.test', 'attempt_id' => a20Attempt()])
            ->assertStatus(429)->assertJsonPath('code', ErrorCode::RateLimited->value)->assertHeader('Retry-After');
    });

    it('stores only keyed hashes, no address or network identifier', function () {
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.77'])
            ->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => 'bbbbbbbbbbbbbbbbbbbbbbbbbb'])->assertStatus(202);

        $row = LoginAttempt::query()->sole();
        $code = a20LastCode()->code;

        expect($row->email_hash)->not->toContain('lena')
            ->and($row->email_hash)->toBe(EmailCodes::emailHash('lena@beispiel.test'))
            ->and($row->code_hash)->toBe(hash_hmac('sha256', 'bbbbbbbbbbbbbbbbbbbbbbbbbb'.$code, config()->string('app.key')))
            ->and(array_keys($row->getAttributes()))->not->toContain('ip_trunc')->not->toContain('user_agent')
            ->and($row->expires_at?->diffInMinutes(now(), true))->toBeGreaterThan(9.9);
    });
});

describe('POST auth/email/verify with attempt_id', function () {
    it('creates a pending_terms account for a new address and signs it in', function () {
        [$attempt, $code] = a20Start('neu@beispiel.test');

        $response = $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, 'locale' => 'en', ...a20Device()])
            ->assertOk()
            ->assertJsonPath('data.is_new', true)
            ->assertJsonPath('data.next', 'terms')
            ->assertJsonPath('data.member.next_step', 'accept_terms')
            ->assertJsonPath('data.member.password_set', false)
            ->assertJsonPath('data.member.email_verified', true)
            // The database defaults, as GET me answers them later (M4.6 app lane: was null).
            ->assertJsonPath('data.member.theme', 'carbon');

        $user = User::query()->where('email', 'neu@beispiel.test')->sole();

        expect($response->json('data.token'))->toBeString()
            ->and($user->getAttribute('onboarding_state'))->toBe(OnboardingState::PendingTerms)
            ->and($user->hasPassword())->toBeFalse()
            ->and($user->getAttribute('locale'))->toBe('en')
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::Registered->value)->where('target_id', $user->id)->exists())->toBeTrue();
    });

    it('signs an existing member in, not as new', function () {
        $user = User::factory()->create(['email' => 'da@beispiel.test']);
        [$attempt, $code] = a20Start('da@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertOk()
            ->assertJsonPath('data.is_new', false)
            ->assertJsonPath('data.next', 'done')
            ->assertJsonPath('data.member.id', $user->id);
    });

    it('signs in with the same-device magic token, bound to the attempt id', function () {
        $user = User::factory()->create(['email' => 'da@beispiel.test']);
        [$attempt, , $magic] = a20Start('da@beispiel.test');

        expect($magic)->toBeString();
        // The link carries the token in the fragment only, never the attempt id.
        expect(a20LastCode()->render())->toContain('/auth/magic#t=')->not->toContain($attempt);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => a20Attempt(), 'magic_token' => $magic, ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::InvalidCode->value);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'magic_token' => $magic, ...a20Device()])
            ->assertOk()->assertJsonPath('data.member.id', $user->id);
    });

    it('needs a code or a magic token', function () {
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => a20Attempt(), ...a20Device()])
            ->assertStatus(422)->assertJsonValidationErrors(['code', 'magic_token']);
    });

    it('counts wrong codes, says how many are left, and spends the code after 5', function () {
        [$attempt, $code] = a20Start('lena@beispiel.test');
        $verify = fn (string $c) => $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $attempt, 'code' => $c, ...a20Device()]);

        $verify(a20Other($code))->assertStatus(422)->assertJsonPath('code', 'invalid_code')->assertJsonPath('attempts_left', 4)
            ->assertJsonPath('message', 'Der Code stimmt nicht. Noch 4 Versuche.');

        foreach (range(1, 4) as $i) {
            $verify(a20Other($code))->assertStatus(422);
        }

        // The right code no longer counts.
        $verify($code)->assertStatus(422)->assertJsonPath('code', 'invalid_code')->assertJsonPath('attempts_left', 0);
    });

    it('refuses a reused code and a code of another attempt or address', function () {
        User::factory()->create(['email' => 'da@beispiel.test']);
        [$attempt, $code] = a20Start('da@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'anders@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])->assertStatus(422);
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])->assertOk();
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_code');
    });

    it('answers code_expired after 10 minutes', function () {
        [$attempt, $code] = a20Start('lena@beispiel.test');
        $this->travel(11)->minutes();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', ErrorCode::CodeExpired->value);
    });

    it('closes the earlier code when a new one is sent', function () {
        [$first, $old] = a20Start('lena@beispiel.test');
        $this->travel(31)->seconds();
        [$second, $new] = a20Start('lena@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $first, 'code' => $old, ...a20Device()])->assertStatus(422);
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $second, 'code' => $new, ...a20Device()])->assertOk();
    });

    it('locks this client out of the address for 15 minutes after 10 failures an hour, mails the owner and refuses even the right code', function () {
        $user = User::factory()->create(['email' => 'da@beispiel.test']);
        [$first, $firstCode] = a20Start('da@beispiel.test');

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $first, 'code' => a20Other($firstCode), ...a20Device()])->assertStatus(422);
        }

        // Five more against a second code of the same address (SEC-M46-03: only existing attempts count).
        $this->travel(31)->seconds();
        [$attempt, $code] = a20Start('da@beispiel.test');

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'code' => a20Other($code), ...a20Device()])->assertStatus(422);
        }

        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail) => $mail->notice === SecurityNotice::EmailCodeLocked && $mail->hasTo('da@beispiel.test'));
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::EmailCodeLocked->value)->where('target_id', $user->id)->count())->toBe(1);

        $this->travel(31)->seconds();
        [$fresh, $freshCode] = [a20Attempt(), null];
        $this->postJson('/api/v1/auth/email/start', ['email' => 'da@beispiel.test', 'attempt_id' => $fresh])->assertStatus(202)
            ->assertJsonPath('data.resend_after', fn (int $seconds) => $seconds > 800);
        // Nothing new during the lock.
        expect(Mail::sent(EmailCodeMail::class)->count())->toBe(2);

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertStatus(429)->assertJsonPath('code', ErrorCode::EmailCodeLocked->value)->assertHeader('Retry-After')
            ->assertJsonPath('retry_after', fn (int $seconds) => $seconds > 800 && $seconds <= 900);

        $this->travel(16)->minutes();
        [$again, $againCode] = a20Start('da@beispiel.test');
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'da@beispiel.test', 'attempt_id' => $again, 'code' => $againCode, ...a20Device()])->assertOk();
    });

    it('never locks on attempts that do not exist, known address or not (SEC-M46-03)', function (string $email) {
        User::factory()->create(['email' => 'da@beispiel.test']);

        foreach (range(1, 12) as $i) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()])
                ->assertStatus(422)->assertJsonPath('code', 'invalid_code');
        }

        Mail::assertNothingSent();
    })->with(['da@beispiel.test', 'niemand@beispiel.test']);

    it('locks an unknown address the same way as a known one when its codes are failed, without any mail', function () {
        foreach (range(1, 2) as $round) {
            $this->travel(31)->seconds();
            $id = a20Attempt();
            $this->postJson('/api/v1/auth/email/start', ['email' => 'niemand@beispiel.test', 'attempt_id' => $id])->assertStatus(202);

            foreach (range(1, 5) as $i) {
                $this->postJson('/api/v1/auth/email/verify', ['email' => 'niemand@beispiel.test', 'attempt_id' => $id, 'code' => '123456', ...a20Device()]);
            }
        }

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'niemand@beispiel.test', 'attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()])
            ->assertStatus(429)->assertJsonPath('code', ErrorCode::EmailCodeLocked->value);
        Mail::assertNotSent(SecurityNoticeMail::class);
    });

    it('answers a closed account like a wrong code', function () {
        $user = User::factory()->create(['email' => 'zu@beispiel.test']);
        $attempt = a20Attempt();
        $this->postJson('/api/v1/auth/email/start', ['email' => 'zu@beispiel.test', 'attempt_id' => $attempt])->assertStatus(202);
        $user->forceFill(['deletion_requested_at' => now()])->save();
        $row = LoginAttempt::query()->sole();
        $row->forceFill(['code_hash' => EmailCodes::codeHash($attempt, '654321')])->save();

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'zu@beispiel.test', 'attempt_id' => $attempt, 'code' => '654321', ...a20Device()])
            ->assertStatus(422)->assertJsonPath('code', 'invalid_code');
    });

    it('asks for the second factor of an account with two-factor', function () {
        $user = User::factory()->create(['email' => 'zwei@beispiel.test']);
        $user->forceFill(['two_factor_secret' => app(TwoFactor::class)->newSecret(), 'two_factor_confirmed_at' => now()])->save();
        [$attempt, $code] = a20Start('zwei@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'zwei@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertOk()
            ->assertJsonPath('data.two_factor_required', true)
            ->assertJsonMissingPath('data.token');
    });

    it('proves an unverified account: its password and profile go, the terms are asked again', function () {
        $user = User::factory()->create(['email' => 'offen@beispiel.test', 'email_verified_at' => null, 'display_name' => 'Fremder']);
        [$attempt, $code] = a20Start('offen@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'offen@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
            ->assertOk()->assertJsonPath('data.is_new', false)->assertJsonPath('data.next', 'terms');

        $user->refresh();
        expect($user->hasVerifiedEmail())->toBeTrue()
            ->and($user->hasPassword())->toBeFalse()
            ->and($user->getAttribute('display_name'))->toBeNull()
            ->and($user->isPendingTerms())->toBeTrue();
    });

    it('signs in the SPA session without a device', function () {
        User::factory()->create(['email' => 'web@beispiel.test']);
        [$attempt, $code] = a20Start('web@beispiel.test');

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'web@beispiel.test', 'attempt_id' => $attempt, 'code' => $code])
            ->assertStatus(419)->assertJsonPath('code', ErrorCode::SessionExpired->value);
    });

    it('signs the member web in on its cookie session, as a recent authentication', function () {
        config(['session.driver' => 'database']);
        app()->forgetInstance('session.store');
        $user = User::factory()->create(['email' => 'web@beispiel.test']);
        $user->forceFill(['password' => null])->save();
        $cookie = $this->withHeaders(['Origin' => 'http://localhost:8080'])->get('/sanctum/csrf-cookie')->assertNoContent()
            ->getCookie(config()->string('session.cookie'))?->getValue();
        [$attempt, $code] = a20Start('web@beispiel.test');
        $spa = fn () => $this->withCredentials()->withCookie(config()->string('session.cookie'), (string) $cookie)->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json']);

        $signedIn = $spa()->postJson('/api/v1/auth/email/verify', ['email' => 'web@beispiel.test', 'attempt_id' => $attempt, 'code' => $code])
            ->assertOk()->assertJsonPath('data.token', null)->assertJsonPath('data.member.id', $user->id);
        $session = $signedIn->getCookie(config()->string('session.cookie'))?->getValue() ?? $cookie;

        app('auth')->forgetGuards();
        app()->forgetInstance('session.store');
        $this->withCredentials()->withCookie(config()->string('session.cookie'), (string) $session)->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
            ->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.password_set', false);
    });

    it('keeps the registration verify working without attempt_id', function () {
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@beispiel.test', 'code' => '123456', ...a20Device()])
            ->assertStatus(422)->assertJsonValidationErrors('password');
    });

    it('limits passwordless verifies per IP', function () {
        foreach (range(1, 30) as $i) {
            $this->postJson('/api/v1/auth/email/verify', ['email' => "x$i@beispiel.test", 'attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()]);
        }

        $this->postJson('/api/v1/auth/email/verify', ['email' => 'y@beispiel.test', 'attempt_id' => a20Attempt(), 'code' => '123456', ...a20Device()])->assertStatus(429);
    });
});

describe('AUTH-09b POST me/onboarding/accept', function () {
    it('keeps a pending account from creating anything until it accepts', function () {
        [$user, $token] = a20Passwordless('neu@beispiel.test', pendingTerms: true);

        $this->withToken($token)->patchJson('/api/v1/me/profile', ['display_name' => 'Lena'])
            ->assertStatus(403)->assertJsonPath('code', ErrorCode::TermsRequired->value);
        $this->withToken($token)->putJson('/api/v1/me/username', ['username' => 'lenaneu'])
            ->assertStatus(403)->assertJsonPath('code', ErrorCode::TermsRequired->value);
        // Reads stay open.
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.next_step', 'accept_terms');

        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])
            ->assertOk()->assertJsonPath('data.next_step', null);

        $user->refresh();
        expect($user->isPendingTerms())->toBeFalse()
            ->and($user->getAttribute('age_confirmed_at'))->not->toBeNull()
            ->and($user->getAttribute('consented_at'))->not->toBeNull()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::TermsAccepted->value)->exists())->toBeTrue();

        $this->app['auth']->forgetGuards();
        $this->withToken($token)->patchJson('/api/v1/me/profile', ['display_name' => 'Lena'])->assertOk();
    });

    it('needs the age line and both versions', function (array $body, string $field) {
        [, $token] = a20Passwordless('neu@beispiel.test', pendingTerms: true);

        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', $body)->assertStatus(422)->assertJsonValidationErrors($field);
    })->with([
        'age not ticked' => [['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => false], 'age_confirmed'],
        'no terms version' => [['privacy_version' => '1', 'age_confirmed' => true], 'terms_version'],
        'no privacy version' => [['terms_version' => '1', 'age_confirmed' => true], 'privacy_version'],
    ]);

    it('answers 409 once accepted, 401 to a guest', function () {
        [, $token] = a20Passwordless('da@beispiel.test');

        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])->assertStatus(409);
        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])->assertUnauthorized();
    });

    it('refuses an outdated version of a published text', function () {
        LegalDocument::factory()->create(['key' => 'terms', 'locale' => 'de', 'version' => '2026-11', 'published_at' => now()->subDay()]);
        [, $token] = a20Passwordless('neu@beispiel.test', pendingTerms: true);

        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '2025-01', 'privacy_version' => '1', 'age_confirmed' => true])
            ->assertStatus(422)->assertJsonValidationErrors('terms_version');
    });
});
