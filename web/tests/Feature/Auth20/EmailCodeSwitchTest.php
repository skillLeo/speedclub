<?php

use App\Mail\EmailCodeMail;
use App\Models\User;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/Helpers.php';

/**
 * ADR-520: `auth.email_code` can be switched off on a host that cannot deliver mail yet (staging before SMTP, owner report
 * 2026-11-16 "the code never reaches Gmail"). Off: no code goes out, the passwordless form of email/verify is refused, password
 * sign-in stays open (whatever `auth.password_login` says) and SET-19 says so. A host without the flag row keeps the code
 * (the app reads the flag the same way, authFlags.ts `onUnlessOff`).
 */
beforeEach(function () {
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
});

it('sends no code and answers 404 feature_disabled while the e-mail code is switched off', function () {
    User::factory()->create(['email' => 'lena@beispiel.test']);
    a20Flag('auth.email_code', false);

    $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])
        ->assertNotFound()
        ->assertJsonPath('code', 'feature_disabled');

    Mail::assertNothingSent();
});

it('refuses a code that went out before the switch, and keeps it refused only while the switch is off', function () {
    User::factory()->create(['email' => 'lena@beispiel.test']);
    [$attempt, $code] = a20Start('lena@beispiel.test');
    a20Flag('auth.email_code', false);

    $this->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
        ->assertNotFound()
        ->assertJsonPath('code', 'feature_disabled');

    a20Flag('auth.email_code');

    $this->postJson('/api/v1/auth/email/verify', ['email' => 'lena@beispiel.test', 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
        ->assertOk()
        ->assertJsonStructure(['data' => ['token']]);
});

it('keeps the code on a host without the flag row and while the flag is on', function () {
    User::factory()->create(['email' => 'lena@beispiel.test']);

    $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);
    a20Flag('auth.email_code');
    $this->travel(2)->minutes();
    $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);

    Mail::assertSent(EmailCodeMail::class, 2);
});

it('leaves password sign-in and the registration form of email/verify alone', function () {
    a20Flag('auth.email_code', false);
    a20Flag('auth.password_login', false);
    $member = User::factory()->create(['email' => 'lena@beispiel.test']);

    $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', ...a20Device()])
        ->assertOk()
        ->assertJsonStructure(['data' => ['token']]);

    // The registration form (no attempt_id) is not the passwordless sign-in: a wrong code is its own 422, never feature_disabled.
    $this->postJson('/api/v1/auth/email/verify', ['email' => 'neu@beispiel.test', 'code' => '000000', 'password' => 'password', 'device_name' => 'Pixel 9'])
        ->assertUnprocessable()
        ->assertJsonPath('code', 'invalid_code');
});

it('tells SET-19 that the code is off and the password is the way in', function () {
    a20Flag('auth.password_login', false);
    $member = User::factory()->create(['email' => 'lena@beispiel.test']);
    $token = test()->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', ...a20Device()])->json('data.token');

    $on = $this->withToken($token)->getJson('/api/v1/me/sign-in-methods')->assertOk()->json('data');
    expect($on['email_code']['available'])->toBeTrue()->and($on['password']['available'])->toBeFalse();

    a20Flag('auth.email_code', false);
    $off = $this->withToken($token)->getJson('/api/v1/me/sign-in-methods')->assertOk()->json('data');
    expect($off['email_code']['available'])->toBeFalse()->and($off['password']['available'])->toBeTrue();
});
