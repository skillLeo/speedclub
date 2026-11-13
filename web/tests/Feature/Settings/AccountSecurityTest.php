<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Mail\EmailChangeAttemptMail;
use App\Mail\EmailChangeCodeMail;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

/**
 * The code the change mail carried.
 */
function setEmailCode(string $to): string
{
    $code = null;

    Mail::assertSent(EmailChangeCodeMail::class, function (EmailChangeCodeMail $mail) use ($to, &$code): bool {
        $code = $mail->code;

        return $mail->hasTo($to);
    });

    return (string) $code;
}

describe('SET-03 e-mail change', function () {
    it('sends a code to the new address, then switches and tells the old one', function () {
        $member = setMember(['email' => 'lena@example.de']);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/email', ['email' => 'Lena.Neu@Example.de', 'password' => 'password'])
            ->assertStatus(202)
            ->assertExactJson(['data' => ['email' => 'lena.neu@example.de', 'resend_after_seconds' => 60]]);

        $code = setEmailCode('lena.neu@example.de');
        expect($member->fresh()->email)->toBe('lena@example.de');

        $this->postJson('/api/v1/me/email/confirm', ['code' => $code])->assertOk()->assertJsonPath('data.email', 'lena.neu@example.de');

        $fresh = $member->fresh();
        expect($fresh->email)->toBe('lena.neu@example.de')->and($fresh->hasVerifiedEmail())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::EmailChanged && $mail->hasTo('lena@example.de'));
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::EmailChanged->value)->where('target_id', $member->id)->exists())->toBeTrue()
            ->and(Notification::query()->where('notifiable_id', $member->id)->where('type', 'security')->exists())->toBeTrue();

        // The code is spent.
        $this->postJson('/api/v1/me/email/confirm', ['code' => $code])->assertUnprocessable()->assertJsonPath('code', 'invalid_code');
    });

    it('answers the same for a taken address, mails its owner and never switches', function () {
        $owner = setMember(['email' => 'jann@example.de']);
        $member = setMember(['email' => 'lena@example.de']);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/email', ['email' => 'jann@example.de', 'password' => 'password'])
            ->assertStatus(202)->assertExactJson(['data' => ['email' => 'jann@example.de', 'resend_after_seconds' => 60]]);

        Mail::assertNotSent(EmailChangeCodeMail::class);
        Mail::assertSent(EmailChangeAttemptMail::class, fn (EmailChangeAttemptMail $mail): bool => $mail->hasTo('jann@example.de'));

        $this->postJson('/api/v1/me/email/confirm', ['code' => '123456'])
            ->assertUnprocessable()->assertJsonPath('errors.email.0', __('settings.email.unavailable', [], 'de'));
        expect($member->fresh()->email)->toBe('lena@example.de')->and($owner->fresh()->email)->toBe('jann@example.de');
    });

    it('never switches to an address registered after the code was sent', function () {
        $member = setMember(['email' => 'lena@example.de']);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password'])->assertStatus(202);
        $code = setEmailCode('neu@example.de');
        setMember(['email' => 'neu@example.de']);

        $this->postJson('/api/v1/me/email/confirm', ['code' => $code])->assertUnprocessable()->assertJsonValidationErrors('email');
        expect($member->fresh()->email)->toBe('lena@example.de');
    });

    it('validates and checks the password', function () {
        $member = setMember(['email' => 'lena@example.de']);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'wrong-wrong'])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/me/email', ['email' => 'lena@example.de', 'password' => 'password'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/me/email', ['email' => 'kein-at-zeichen', 'password' => 'password'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/me/email', ['email' => 'jürgen@example.de', 'password' => 'password'])->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/me/email/confirm', ['code' => '12'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/v1/me/email/confirm', ['code' => '123456'])->assertUnprocessable()->assertJsonPath('code', 'invalid_code');
        // Only the notice of the wrong password (fix round, should-fix 5): no code went anywhere.
        Mail::assertNotSent(EmailChangeCodeMail::class);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::VerificationFailed && $mail->variant === 'password');
    });

    it('spends the email_change budget of ADR-134, then stays neutral and sends nothing', function () {
        $member = setMember();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password'])->assertStatus(202);
        // Within the 60 s cooldown: the same 202, no second mail.
        $this->postJson('/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password'])->assertStatus(202);

        Mail::assertSent(EmailChangeCodeMail::class, 1);
        expect(app(VerificationCodes::class)->issuedToday($member, VerificationPurpose::EmailChange))->toBe(1);
    });
});

describe('SET-04 password change', function () {
    it('changes the password, keeps this device, and mails', function () {
        $member = setMember();
        $here = setSignIn($member, 'install-here-0001');
        $there = setSignIn($member, 'install-there-001', 'Pixel 9');

        $this->withToken($here)->postJson('/api/v1/me/password', [
            'current_password' => 'password',
            'password' => 'Ein-neues-Passwort-26',
            'password_confirmation' => 'Ein-neues-Passwort-26',
        ])->assertNoContent();
        app('auth')->forgetGuards();

        expect(Hash::check('Ein-neues-Passwort-26', $member->fresh()->getAuthPassword()))->toBeTrue();
        $this->withToken($here)->getJson('/api/v1/auth/me')->assertOk();
        app('auth')->forgetGuards();
        $this->withToken($there)->getJson('/api/v1/auth/me')->assertOk();

        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::PasswordChanged && $mail->variant === 'kept');
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::PasswordChanged->value)->where('target_id', $member->id)->exists())->toBeTrue();
    });

    it('signs out the other devices and their push tokens on request', function () {
        $member = setMember();
        $here = setSignIn($member, 'install-here-0001');
        $there = setSignIn($member, 'install-there-001', 'Pixel 9');
        PushToken::factory()->create(['user_id' => $member->id, 'device_id' => DeviceInstalls::key($member->id, 'install-there-001'), 'token' => 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]']);
        PushToken::factory()->create(['user_id' => $member->id, 'device_id' => DeviceInstalls::key($member->id, 'install-here-0001'), 'token' => 'ExponentPushToken[cccccccccccccccccccccc]']);

        $this->withToken($here)->postJson('/api/v1/me/password', [
            'current_password' => 'password',
            'password' => 'Ein-neues-Passwort-26',
            'password_confirmation' => 'Ein-neues-Passwort-26',
            'revoke_other_sessions' => true,
        ])->assertNoContent();
        app('auth')->forgetGuards();

        $this->withToken($there)->getJson('/api/v1/auth/me')->assertUnauthorized();
        app('auth')->forgetGuards();
        $this->withToken($here)->getJson('/api/v1/auth/me')->assertOk();
        expect($member->pushTokens()->pluck('device_id')->all())->toBe([DeviceInstalls::key($member->id, 'install-here-0001')]);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->variant === 'others_signed_out');
    });

    it('refuses a wrong current password, the same password, the username and a weak one', function (array $body, string $field) {
        $member = setMember(['username' => 'lenaundich']);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/password', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
        expect(Hash::check('password', $member->fresh()->getAuthPassword()))->toBeTrue();
    })->with([
        'wrong current' => [['current_password' => 'falsch-falsch', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26'], 'current_password'],
        'too short' => [['current_password' => 'password', 'password' => 'kurz', 'password_confirmation' => 'kurz'], 'password'],
        'not confirmed' => [['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'anders-anders-1'], 'password'],
        'username' => [['current_password' => 'password', 'password' => 'lenaundich', 'password_confirmation' => 'lenaundich'], 'password'],
        'non-boolean switch' => [['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26', 'revoke_other_sessions' => 'yes'], 'revoke_other_sessions'],
    ]);

    it('refuses the current password as the new one', function () {
        $member = setMember();
        $member->forceFill(['password' => Hash::make('Altes-Passwort-2026')])->save();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/password', ['current_password' => 'Altes-Passwort-2026', 'password' => 'Altes-Passwort-2026', 'password_confirmation' => 'Altes-Passwort-2026'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');
    });
});

it('limits re-authenticated changes to 10 in 10 minutes per member', function () {
    $member = setMember();
    Sanctum::actingAs($member);

    // Wrong codes, not wrong passwords: those have their own 5 an hour (see below).
    for ($i = 0; $i < 10; $i++) {
        $this->postJson('/api/v1/me/email/confirm', ['code' => '123456'])->assertUnprocessable();
    }

    $this->postJson('/api/v1/me/password', ['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26'])
        ->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    expect(User::query()->whereKey($member->id)->value('password'))->toBe($member->getAuthPassword());
});
