<?php

use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Mail\EmailCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\LoginAttempt;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Settings/SettingsTestHelpers.php';

/**
 * Client round 6, L3 (live test 2026-11-24): WEB-05 /konto-loeschen for members without a password (Auth 2.0, M4.6). A 6-digit code of
 * purpose account_deletion goes to the address (10 minutes, single use, hashed at rest, EmailCodes); e-mail + code (+ the second factor)
 * closes the account through the same DeleteAccount as the password. Functions are prefixed adc.
 */
beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
});

function adcPasswordless(array $attributes = []): User
{
    $user = setMember($attributes);
    $user->forceFill(['password' => null])->save();

    return $user->fresh() ?? $user;
}

/**
 * Asks for a deletion code on the page and returns [response, attempt id from the form].
 *
 * @return array{0: TestResponse, 1: string}
 */
function adcRequest(string $email): array
{
    $response = test()->post('/konto-loeschen/code', ['email' => $email]);
    preg_match('/name="attempt" value="([^"]*)"/', (string) $response->getContent(), $match);

    return [$response, $match[1] ?? ''];
}

function adcMailedCode(string $email): string
{
    $mail = Mail::sent(EmailCodeMail::class, fn (EmailCodeMail $mail): bool => $mail->hasTo($email))->last();

    if (! $mail instanceof EmailCodeMail) {
        throw new RuntimeException('No EmailCodeMail was sent to '.$email.'.');
    }

    expect($mail->purpose)->toBe(LoginPurpose::AccountDeletion);

    return (string) $mail->code;
}

/**
 * @param  array<string, string>  $extra
 */
function adcDelete(string $email, string $attempt, string $code, array $extra = []): TestResponse
{
    return test()->post('/konto-loeschen', ['email' => $email, 'attempt' => $attempt, 'email_code' => $code, 'confirm' => '1', ...$extra]);
}

describe('WEB-05 deletion by e-mail code', function () {
    it('deletes a passwordless account with a code sent to its address', function () {
        $member = adcPasswordless(['email' => 'lena@beispiel.test']);
        expect($member->hasPassword())->toBeFalse();

        $this->get('/konto-loeschen')->assertOk()->assertSee('data-testid="WEB-05.request-code"', false);

        [$response, $attempt] = adcRequest('Lena@Beispiel.test');
        $response->assertOk()
            ->assertSee('data-testid="WEB-05.email-code"', false)
            ->assertSee(__('public.account_deletion.code_sent', ['minutes' => 10], 'de'));
        expect($attempt)->not->toBe('')
            ->and($response->headers->getCookies())->toBe([])
            ->and(LoginAttempt::query()->where('purpose', LoginPurpose::AccountDeletion)->value('code_hash'))->not->toBe(adcMailedCode('lena@beispiel.test'));

        adcDelete('lena@beispiel.test', $attempt, adcMailedCode('lena@beispiel.test'))
            ->assertOk()->assertSee(__('public.account_deletion.done_title', [], 'de'));

        expect($member->fresh()->isPendingDeletion())->toBeTrue()
            ->and(AuditEvent::query()->where('action', MemberSecurityEvent::DeletionRequested->value)->where('target_id', $member->id)->exists())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::DeletionRequested);
    });

    it('refuses a wrong code, an expired code, a reused code and a code of another page', function () {
        $member = adcPasswordless(['email' => 'lena@beispiel.test']);
        [, $attempt] = adcRequest($member->email);
        $code = adcMailedCode($member->email);
        $wrong = $code === '000000' ? '111111' : '000000';

        adcDelete($member->email, $attempt, $wrong)->assertUnprocessable()->assertSee('data-testid="WEB-05.email-code.error"', false);
        // The code is bound to the page that asked for it (the attempt id), not only to the address.
        adcDelete($member->email, str_repeat('a', 40), $code)->assertUnprocessable();
        expect($member->fresh()->isPendingDeletion())->toBeFalse();

        $this->travel(11)->minutes();
        adcDelete($member->email, $attempt, $code)->assertUnprocessable()->assertSee(__('errors.code_expired', [], 'de'));
        expect($member->fresh()->isPendingDeletion())->toBeFalse();

        // A fresh code works once; using it again is refused.
        $this->travelBack();
        $this->travel(3)->minutes();
        [, $fresh] = adcRequest($member->email);
        $code = adcMailedCode($member->email);
        adcDelete($member->email, $fresh, $code)->assertOk();
        expect($member->fresh()->isPendingDeletion())->toBeTrue();
        adcDelete($member->email, $fresh, $code)->assertUnprocessable();
    });

    it('locks a code after five wrong tries, like the sign-in codes', function () {
        $member = adcPasswordless();
        [, $attempt] = adcRequest($member->email);
        $code = adcMailedCode($member->email);
        $wrong = $code === '000000' ? '111111' : '000000';

        for ($i = 0; $i < 5; $i++) {
            adcDelete($member->email, $attempt, $wrong)->assertUnprocessable();
        }

        adcDelete($member->email, $attempt, $code)->assertUnprocessable();
        expect($member->fresh()->isPendingDeletion())->toBeFalse();
    });

    it('locks the address for this client after ten wrong codes an hour, and tells the member once', function () {
        $member = adcPasswordless();

        for ($round = 0; $round < 2; $round++) {
            $this->travel(3)->minutes();
            [, $attempt] = adcRequest($member->email);
            $code = adcMailedCode($member->email);
            $wrong = $code === '000000' ? '111111' : '000000';

            for ($i = 0; $i < 5; $i++) {
                adcDelete($member->email, $attempt, $wrong)->assertUnprocessable();
            }
        }

        $this->travel(3)->minutes();
        [$locked] = adcRequest($member->email);
        $locked->assertStatus(429);
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::EmailCodeLocked->value)->where('target_id', $member->id)->count())->toBe(1);
    });

    it('answers an unknown, a closed and a password address the same, and mails only an open account', function () {
        $passwordless = adcPasswordless(['email' => 'lena@beispiel.test']);
        $withPassword = setMember(['email' => 'paul@beispiel.test']);
        $closed = adcPasswordless(['email' => 'zu@beispiel.test']);
        $closed->forceFill(['deletion_requested_at' => now()])->save();

        $pages = [];

        foreach (['lena@beispiel.test', 'paul@beispiel.test', 'zu@beispiel.test', 'niemand@beispiel.test'] as $email) {
            [$response, $attempt] = adcRequest($email);
            $response->assertOk();
            $pages[$email] = str_replace([$email, $attempt], ['EMAIL', 'ATTEMPT'], (string) $response->getContent());
        }

        expect(array_unique(array_map(fn (string $page): string => preg_replace('/nonce="[^"]*"/', '', $page) ?? '', $pages)))->toHaveCount(1);
        Mail::assertSent(EmailCodeMail::class, 2);
        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail): bool => $mail->hasTo($passwordless->email));
        Mail::assertSent(EmailCodeMail::class, fn (EmailCodeMail $mail): bool => $mail->hasTo($withPassword->email));
        Mail::assertNotSent(EmailCodeMail::class, fn (EmailCodeMail $mail): bool => $mail->hasTo('niemand@beispiel.test') || $mail->hasTo('zu@beispiel.test'));
    });

    it('limits codes per address and requests per IP', function () {
        $member = adcPasswordless();

        adcRequest($member->email)[0]->assertOk();
        // Within the cooldown nothing is sent, for any address alike.
        adcRequest($member->email)[0]->assertStatus(429)->assertSee('data-testid="WEB-05.form.error"', false);
        Mail::assertSent(EmailCodeMail::class, 1);

        $max = config()->integer('speedclub.rate_limits.web_account_deletion_code.max');

        for ($i = 2; $i < $max; $i++) {
            adcRequest('x'.$i.'@beispiel.test');
        }

        adcRequest('y@beispiel.test')[0]->assertStatus(429);
    });

    it('still needs the second factor when two-factor is on, and keeps the code until it comes', function () {
        $member = adcPasswordless();
        [$secret] = setEnableTwoFactor($member);
        [, $attempt] = adcRequest($member->email);
        $code = adcMailedCode($member->email);

        adcDelete($member->email, $attempt, $code)->assertUnprocessable()->assertSee('Authenticator-App');
        adcDelete($member->email, $attempt, $code, ['code' => '000000'])->assertUnprocessable()->assertSee('data-testid="WEB-05.code.error"', false);
        expect($member->fresh()->isPendingDeletion())->toBeFalse()
            ->and(RateLimiter::attempts('second-factor-fail-hour:'.$member->id))->toBe(1);

        adcDelete($member->email, $attempt, $code, ['code' => setOtp($secret)])->assertOk();
        expect($member->fresh()->isPendingDeletion())->toBeTrue();
    });

    it('keeps the password path for accounts with a password', function () {
        $member = setMember();

        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1'])
            ->assertOk()->assertSee(__('public.account_deletion.done_title', [], 'de'));
        expect($member->fresh()->isPendingDeletion())->toBeTrue();
        Mail::assertNotSent(EmailCodeMail::class);
    });

    it('needs the address, the confirmation box and a six-digit code', function () {
        $member = adcPasswordless();
        [, $attempt] = adcRequest($member->email);
        $code = adcMailedCode($member->email);

        $this->post('/konto-loeschen/code', ['email' => 'keine-adresse'])->assertUnprocessable();
        $this->post('/konto-loeschen', ['email' => $member->email, 'attempt' => $attempt, 'email_code' => $code])
            ->assertUnprocessable()->assertSee('endgültig löschen willst')->assertSee('name="attempt" value="'.$attempt.'"', false);
        $this->post('/konto-loeschen', ['email' => $member->email, 'attempt' => $attempt, 'confirm' => '1'])
            ->assertUnprocessable()->assertSee('data-testid="WEB-05.email-code.error"', false);
        expect($member->fresh()->isPendingDeletion())->toBeFalse();

        adcDelete($member->email, $attempt, $code)->assertOk();
    });

    it('refuses cross-site posts and checks Turnstile when configured', function () {
        $member = adcPasswordless();

        $this->withHeader('Sec-Fetch-Site', 'cross-site')->post('/konto-loeschen/code', ['email' => $member->email])->assertUnprocessable();
        Mail::assertNothingSent();

        config(['speedclub.services.turnstile_site_key' => 'site-key', 'speedclub.services.turnstile_secret' => 'secret']);
        Http::preventStrayRequests();
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => false])]);

        $this->withHeader('Sec-Fetch-Site', 'same-origin')->post('/konto-loeschen/code', ['email' => $member->email, 'cf-turnstile-response' => 'token'])
            ->assertUnprocessable()->assertSee('Sicherheitsprüfung');
        Mail::assertNothingSent();
    });

    it('holds the authorisation matrix: the code proves one address only, whoever is signed in', function () {
        $owner = adcPasswordless(['email' => 'lena@beispiel.test']);
        $other = adcPasswordless(['email' => 'nina@beispiel.test']);

        // Another member, signed in, with a valid code of their own address, cannot close the owner's account.
        Sanctum::actingAs($other);
        [, $attemptOther] = adcRequest($other->email);
        $codeOther = adcMailedCode($other->email);
        adcDelete($owner->email, $attemptOther, $codeOther)->assertUnprocessable();
        expect($owner->fresh()->isPendingDeletion())->toBeFalse()
            ->and($other->fresh()->isPendingDeletion())->toBeFalse();
        app('auth')->forgetGuards();

        // A restricted (suspended) member can still delete (GDPR), as a guest without a session.
        $suspended = User::factory()->suspended()->create(['email' => 'gesperrt@beispiel.test']);
        $suspended->forceFill(['password' => null])->save();
        [, $attempt] = adcRequest($suspended->email);
        adcDelete($suspended->email, $attempt, adcMailedCode($suspended->email))->assertOk();
        expect($suspended->fresh()->isPendingDeletion())->toBeTrue();

        // A closed account gets no new code, so nothing can close it twice.
        $this->travel(3)->minutes();
        [, $again] = adcRequest($suspended->email);
        adcDelete($suspended->email, $again, '123456')->assertUnprocessable();
    });
});
