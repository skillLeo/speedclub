<?php

use App\Enums\VerificationPurpose;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;

/**
 * ADR-140: a flagged member must be able to get a code. Their own running client and strangers on forgot must not be able to
 * spend that chance, and the old password must not clear the flag.
 */
const BUDGET_PASSWORD = 'ein-sehr-langes-Passwort-42';

beforeEach(function () {
    Mail::fake();
});

function flaggedMember(): User
{
    return User::factory()->create(['email' => 'pflicht@example.de', 'password' => BUDGET_PASSWORD, 'force_password_change' => true]);
}

function runningClient(User $member): string
{
    return $member->createToken('Pixel', ['member'], now()->addDays(90))->plainTextToken;
}

it('keeps a running client from spending more than a few codes a day', function () {
    $member = flaggedMember();
    $token = runningClient($member);

    foreach (range(1, 24) as $hour) {
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();
        app('auth')->forgetGuards();
        $this->travel(61)->minutes();
    }

    // The rolling day lets one back in as the first code leaves it, never more at once.
    expect(VerificationCode::query()->where('user_id', $member->id)->where('created_at', '>', now()->subDay())->count())
        ->toBeLessThanOrEqual(config()->integer('speedclub.verification.max_background_codes_per_day'));
});

it('leaves login a code after the running client had its share', function () {
    $member = flaggedMember();
    $token = runningClient($member);

    foreach (range(1, 12) as $hour) {
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();
        app('auth')->forgetGuards();
        $this->travel(61)->minutes();
    }

    Mail::fake();

    $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => BUDGET_PASSWORD, 'device_name' => 'P'])
        ->assertForbidden()
        ->assertJsonPath('code', 'password_change_required');

    Mail::assertSent(PasswordResetCodeMail::class, 1);
});

it('leaves forgot a code after the running client had its share', function () {
    $member = flaggedMember();
    $token = runningClient($member);

    foreach (range(1, 12) as $hour) {
        $this->withToken($token)->getJson('/api/v1/auth/me')->assertForbidden();
        app('auth')->forgetGuards();
        $this->travel(61)->minutes();
    }

    Mail::fake();

    $this->postJson('/api/v1/auth/password/forgot', ['email' => 'pflicht@example.de'])->assertStatus(202);

    Mail::assertSent(PasswordResetCodeMail::class, 1);
});

it('gives the owner a code at login even after a stranger spent the whole budget', function () {
    $member = flaggedMember();
    $codes = app(VerificationCodes::class);

    // Requests of forgot over a day, by somebody who only knows the address: the daily limit stops them at ten.
    foreach (range(1, 12) as $round) {
        $codes->issue($member, VerificationPurpose::PasswordReset);
        $this->travel(61)->minutes();
    }

    expect(VerificationCode::query()->where('user_id', $member->id)->count())->toBe(10);

    expect($codes->issue($member, VerificationPurpose::PasswordReset))->toBeNull();

    $this->travel(61)->seconds();

    $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => BUDGET_PASSWORD, 'device_name' => 'P'])->assertForbidden();

    Mail::assertSent(PasswordResetCodeMail::class, 1);
});

it('bounds the codes of a proved sign-in as well', function () {
    $member = flaggedMember();

    foreach (range(1, 8) as $round) {
        $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => BUDGET_PASSWORD, 'device_name' => 'P'])->assertForbidden();
        $this->travel(21)->minutes();
    }

    expect(VerificationCode::query()->where('user_id', $member->id)->where('proved', true)->count())
        ->toBe(config()->integer('speedclub.verification.max_proved_codes_per_day'));
});

it('does not count a code of a stranger against a proved sign-in, nor the other way round', function () {
    $member = flaggedMember();
    $codes = app(VerificationCodes::class);

    expect($codes->issue($member, VerificationPurpose::PasswordReset, proved: true))->not->toBeNull();

    $this->travel(61)->seconds();

    expect($codes->issue($member, VerificationPurpose::PasswordReset))->not->toBeNull();
});

it('still holds the cooldown for a proved sign-in, so a double tap costs one code', function () {
    $member = flaggedMember();
    $codes = app(VerificationCodes::class);

    expect($codes->issue($member, VerificationPurpose::PasswordReset, proved: true))->not->toBeNull()
        ->and($codes->issue($member, VerificationPurpose::PasswordReset, proved: true))->toBeNull();
});

describe('a forced password change', function () {
    it('refuses the current password and keeps flag, code and sessions', function () {
        $member = flaggedMember();
        runningClient($member);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => $code, 'password' => BUDGET_PASSWORD])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('password');

        expect($member->refresh()->force_password_change)->toBeTrue()
            ->and(Hash::check(BUDGET_PASSWORD, $member->getAuthPassword()))->toBeTrue()
            ->and($member->tokens()->count())->toBe(1);

        // The code was not spent: the member types a new password and is done.
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => $code, 'password' => 'ein-ganz-neues-Passwort-77'])->assertOk();

        expect($member->refresh()->force_password_change)->toBeFalse();
    });

    it('does not tell anybody without the code what the password is', function () {
        flaggedMember();

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'pflicht@example.de', 'code' => '000000', 'password' => BUDGET_PASSWORD])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'invalid_code')
            ->assertJsonMissingValidationErrors('password');
    });

    it('lets an ordinary reset keep the old password', function () {
        $member = User::factory()->create(['email' => 'normal@example.de', 'password' => BUDGET_PASSWORD]);
        $code = app(VerificationCodes::class)->issue($member, VerificationPurpose::PasswordReset);

        $this->postJson('/api/v1/auth/password/reset', ['email' => 'normal@example.de', 'code' => $code, 'password' => BUDGET_PASSWORD])->assertOk();
    });
});
