<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Enums\VerificationPurpose;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\KnownDevice;
use App\Models\Notification;
use App\Models\User;
use App\Services\Auth\TwoFactor;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

describe('SET-05 setup', function () {
    it('starts with a 160-bit key, an otpauth URL and an SVG, never cached', function () {
        $member = setMember(['username' => 'lena.911']);
        Sanctum::actingAs($member);

        $response = $this->postJson('/api/v1/me/two-factor', ['password' => 'password'])->assertOk();
        $secret = (string) $response->json('data.secret');

        setAssertNoStore($response);
        expect($secret)->toMatch('/\A[A-Z2-7]{32}\z/')
            ->and(strlen($secret) * 5)->toBeGreaterThanOrEqual(160)
            ->and($response->json('data.otpauth_url'))->toStartWith('otpauth://totp/')->toContain('secret='.$secret)->toContain('lena.911')
            ->and($response->json('data.qr_svg'))->toContain('<svg');

        // Pending: sign-in does not ask for a code yet.
        expect($member->fresh()->hasTwoFactor())->toBeFalse();
    });

    it('confirms with the first code and shows ten recovery codes once, stored only as hashes', function () {
        $member = setMember();
        Sanctum::actingAs($member);

        $secret = (string) $this->postJson('/api/v1/me/two-factor', ['password' => 'password'])->json('data.secret');
        $response = $this->postJson('/api/v1/me/two-factor/confirm', ['code' => setOtp($secret)])->assertOk();
        $codes = $response->json('data.recovery_codes');

        setAssertNoStore($response);
        expect($codes)->toHaveCount(10)->each->toMatch('/\A[A-Z2-9]{5}-[A-Z2-9]{5}\z/');

        $fresh = $member->fresh();
        expect($fresh->hasTwoFactor())->toBeTrue()
            ->and(json_encode($fresh->getAttribute('two_factor_recovery_codes')))->not->toContain($codes[0]);

        expect(AuditEvent::query()->where('action', MemberSecurityEvent::TwoFactorEnabled->value)->where('target_id', $member->id)->exists())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::TwoFactorChanged && $mail->variant === 'enabled');
        expect(Notification::query()->where('notifiable_id', $member->id)->where('type', 'security')->count())->toBe(1);
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.two_factor_enabled', true);
    });

    it('refuses a wrong code, a wrong password, a second setup and an unverified address', function () {
        $member = setMember();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/me/two-factor', ['password' => 'wrong-password'])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '123456'])->assertConflict();

        $this->postJson('/api/v1/me/two-factor', ['password' => 'password'])->assertOk();
        $this->postJson('/api/v1/me/two-factor/confirm', ['code' => '000000'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/v1/me/two-factor/confirm', ['code' => 'abc'])->assertUnprocessable();

        setEnableTwoFactor($member->fresh());
        $this->postJson('/api/v1/me/two-factor', ['password' => 'password'])->assertConflict();

        Sanctum::actingAs(setMember(['email_verified_at' => null]));
        $this->postJson('/api/v1/me/two-factor', ['password' => 'password'])->assertForbidden()->assertJsonPath('code', 'email_not_verified');
    });

    it('turns off with password and a code, or a recovery code once', function () {
        $member = setMember();
        [$secret, $recovery] = setEnableTwoFactor($member);
        Sanctum::actingAs($member);

        $this->deleteJson('/api/v1/me/two-factor', ['password' => 'password', 'code' => '000000'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->deleteJson('/api/v1/me/two-factor', ['password' => 'nope-nope-nope', 'code' => setOtp($secret)])->assertUnprocessable()->assertJsonValidationErrors('password');
        $this->deleteJson('/api/v1/me/two-factor', ['password' => 'password', 'code' => strtolower($recovery[3])])->assertNoContent();

        expect($member->fresh()->hasTwoFactor())->toBeFalse()
            ->and($member->fresh()->getAttribute('two_factor_secret'))->toBeNull();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->variant === 'disabled');
        $this->deleteJson('/api/v1/me/two-factor', ['password' => 'password', 'code' => '123456'])->assertConflict();
    });

    it('replaces every recovery code with a new set', function () {
        $member = setMember();
        [$secret, $old] = setEnableTwoFactor($member);
        Sanctum::actingAs($member);

        $response = $this->postJson('/api/v1/me/two-factor/recovery-codes', ['password' => 'password', 'code' => setOtp($secret)])->assertOk();
        setAssertNoStore($response);

        expect($response->json('data.recovery_codes'))->toHaveCount(10)->not->toContain($old[0])
            ->and(app(TwoFactor::class)->useRecoveryCode($member->fresh(), $old[0]))->toBeFalse()
            ->and(app(TwoFactor::class)->useRecoveryCode($member->fresh(), $response->json('data.recovery_codes.0')))->toBeTrue();
    });

    it('never accepts the same code twice', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        $code = setOtp($secret);

        expect(app(TwoFactor::class)->verifyCode($member, $code))->toBeTrue()
            ->and(app(TwoFactor::class)->verifyCode($member->fresh(), $code))->toBeFalse()
            ->and(app(TwoFactor::class)->verifyCode($member->fresh(), setOtp($secret, 1)))->toBeTrue();
    });
});

describe('AUTH-11 challenge at sign-in', function () {
    it('answers a challenge instead of a token, then the token for a right code', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);

        $login = $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'platform' => 'android', 'device_id' => 'install-bbbb-0002'])
            ->assertOk()
            ->assertJsonPath('data.two_factor_required', true)
            ->assertJsonMissingPath('data.token');
        setAssertNoStore($login);
        expect($member->tokens()->count())->toBe(0);

        $challenge = (string) $login->json('data.challenge');

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '000000', 'device_name' => 'Pixel 9', 'platform' => 'android', 'device_id' => 'install-bbbb-0002'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');

        $ok = $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9', 'platform' => 'android', 'device_id' => 'install-bbbb-0002'])
            ->assertOk();
        expect($ok->json('data.token'))->toBeString()->and($ok->json('data.member.id'))->toBe($member->id);

        // Single use.
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret, 1), 'device_name' => 'Pixel 9'])
            ->assertUnprocessable()->assertJsonPath('code', 'challenge_expired');
    });

    it('takes a recovery code once, and an expired challenge never', function () {
        $member = setMember();
        [, $recovery] = setEnableTwoFactor($member);

        $challenge = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'recovery_code' => $recovery[0], 'device_name' => 'Pixel 9'])->assertOk();
        expect(AuditEvent::query()->where('action', MemberSecurityEvent::RecoveryCodeUsed->value)->exists())->toBeTrue();

        $again = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $again, 'recovery_code' => $recovery[0], 'device_name' => 'Pixel 9'])
            ->assertUnprocessable()->assertJsonValidationErrors('recovery_code');

        $this->travel(6)->minutes();
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $again, 'recovery_code' => $recovery[1], 'device_name' => 'Pixel 9'])
            ->assertUnprocessable()->assertJsonPath('code', 'challenge_expired');
    });

    it('allows five wrong codes a minute per challenge and account', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        $challenge = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');

        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => '000000', 'device_name' => 'Pixel 9'])->assertUnprocessable();
        }

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9'])
            ->assertStatus(429)->assertHeader('Retry-After');

        // Another challenge of the same account is limited too.
        $other = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');
        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $other, 'code' => setOtp($secret), 'device_name' => 'Pixel 9'])->assertStatus(429);
    });

    it('validates the body', function (array $body) {
        $this->postJson('/api/v1/auth/two-factor/challenge', [...$body, 'device_name' => 'Pixel 9'])->assertUnprocessable();
    })->with([
        'no challenge' => [['code' => '123456']],
        'short challenge' => [['challenge' => 'abc', 'code' => '123456']],
        'no code' => [['challenge' => str_repeat('a', 40)]],
        'both codes' => [['challenge' => str_repeat('a', 40), 'code' => '123456', 'recovery_code' => 'ABCDE-FGHJK']],
        'letters in code' => [['challenge' => str_repeat('a', 40), 'code' => '12345a']],
    ]);

    it('asks for the second factor after an e-mail verification too, and keeps 2FA through a reset', function () {
        $member = setMember();
        setEnableTwoFactor($member);

        // Reset by e-mail code does not remove two-factor (contract §1).
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);
        $this->postJson('/api/v1/auth/password/reset', ['email' => $member->email, 'code' => $code, 'password' => 'Neues-Passwort-2026!'])->assertOk();
        expect($member->fresh()->hasTwoFactor())->toBeTrue();

        $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'Neues-Passwort-2026!', 'device_name' => 'Pixel 9'])
            ->assertOk()->assertJsonPath('data.two_factor_required', true);
    });

    it('sends the new-device notice only after the second factor', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        // The very first device of an account is not news (KnownDevices); this one has signed in elsewhere before.
        KnownDevice::factory()->create(['user_id' => $member->id]);

        $challenge = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');
        Mail::assertNotSent(SecurityNoticeMail::class);

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9'])->assertOk();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::NewDevice);
    });

    it('stops a challenge once the account changes its password', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);
        $challenge = (string) $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])->json('data.challenge');

        User::query()->whereKey($member->id)->update(['remember_token' => 'changed-elsewhere']);

        $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => $challenge, 'code' => setOtp($secret), 'device_name' => 'Pixel 9'])
            ->assertUnprocessable()->assertJsonPath('code', 'challenge_expired');
    });
});
