<?php

use App\Enums\OnboardingState;
use App\Mail\EmailCodeMail;
use App\Models\FeatureFlag;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * M4.6 Auth 2.0 (09 §8.1, §8.2) lane-B suites. Functions are prefixed a20.
 */
function a20Attempt(): string
{
    return (string) Str::uuid();
}

/**
 * @return array<string, mixed>
 */
function a20Device(string $name = 'Pixel 9', string $id = 'install-0001-aaaa'): array
{
    return ['device_name' => $name, 'device_id' => $id, 'platform' => 'android', 'app_version' => '2.0.0'];
}

function a20LastCode(): EmailCodeMail
{
    $mail = Mail::sent(EmailCodeMail::class)->last();

    if (! $mail instanceof EmailCodeMail) {
        throw new RuntimeException('No EmailCodeMail was sent.');
    }

    return $mail;
}

/**
 * Starts an e-mail code for $email with a fresh attempt and returns [attempt, code, magic token].
 *
 * @return array{0: string, 1: string, 2: string|null}
 */
function a20Start(string $email): array
{
    $attempt = a20Attempt();
    test()->postJson('/api/v1/auth/email/start', ['email' => $email, 'attempt_id' => $attempt])->assertStatus(202);
    $mail = a20LastCode();

    return [$attempt, (string) $mail->code, $mail->magicToken];
}

/**
 * A passwordless member signed in on a device; returns [user, token].
 *
 * @return array{0: User, 1: string}
 */
function a20Passwordless(string $email = 'lena@beispiel.test', bool $pendingTerms = false): array
{
    $user = User::factory()->create(['email' => $email]);
    $user->forceFill(['password' => null, 'onboarding_state' => $pendingTerms ? OnboardingState::PendingTerms : null])->save();
    [$attempt, $code] = a20Start($email);

    $token = test()->postJson('/api/v1/auth/email/verify', ['email' => $email, 'attempt_id' => $attempt, 'code' => $code, ...a20Device()])
        ->assertOk()
        ->json('data.token');

    return [$user->fresh() ?? $user, (string) $token];
}

function a20Flag(string $key, bool $on = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $on, 'description' => $key]);
}

/**
 * An older token: no recent authentication.
 */
function a20OldToken(User $user): string
{
    $token = $user->createToken('Pixel 9', [config()->string('speedclub.tokens.ability')], now()->addDays(30));
    $token->accessToken->forceFill(['device_name' => 'Pixel 9', 'reauthenticated_at' => null])->save();

    return $token->plainTextToken;
}

function a20Other(string $code): string
{
    return $code === '000000' ? '000001' : '000000';
}
