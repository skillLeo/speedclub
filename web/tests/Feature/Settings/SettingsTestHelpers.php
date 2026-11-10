<?php

use App\Models\DataExport;
use App\Models\User;
use App\Services\Auth\TwoFactor;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PragmaRX\Google2FA\Google2FA;

/**
 * M2.5 settings test helpers, prefixed set… so they never collide with another file's functions.
 */
function setMember(array $attributes = []): User
{
    return User::factory()->create($attributes);
}

/**
 * A real app sign-in through auth/login, so tokens carry their device fields. Returns the plain token.
 */
function setSignIn(User $user, string $deviceId = 'install-aaaa-0001', string $name = 'iPhone 15 Pro', string $password = 'password'): string
{
    $response = test()->postJson('/api/v1/auth/login', [
        'email' => $user->email,
        'password' => $password,
        'device_name' => $name,
        'platform' => 'ios',
        'app_version' => '0.1.0',
        'device_id' => $deviceId,
    ]);

    $response->assertOk();
    app('auth')->forgetGuards();

    return (string) $response->json('data.token');
}

/**
 * The code an authenticator app shows now, or $steps 30-second steps later.
 */
function setOtp(string $secret, int $steps = 0): string
{
    $totp = app(Google2FA::class);

    return $totp->oathTotp($secret, $totp->getTimestamp() + $steps);
}

/**
 * Two-factor on, confirmed. Returns [secret, recovery codes].
 *
 * @return array{0: string, 1: list<string>}
 */
function setEnableTwoFactor(User $user): array
{
    $service = app(TwoFactor::class);
    $secret = $service->newSecret();
    $codes = $service->newRecoveryCodes();

    $user->forceFill([
        'two_factor_secret' => $secret,
        'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => $codes['hashes'],
        'two_factor_last_step' => null,
    ])->save();

    return [$secret, $codes['plain']];
}

function setAssertNoStore(TestResponse $response): void
{
    expect((string) $response->headers->get('Cache-Control'))->toContain('no-store');
}

/**
 * @return array<string, string> entry name => contents
 */
function setReadZip(DataExport $export): array
{
    $zip = new ZipArchive;
    expect($zip->open(Storage::disk('local')->path(BuildDataExport::zipPath($export)), ZipArchive::CHECKCONS))->toBeTrue();

    $entries = [];

    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = (string) $zip->getNameIndex($i);
        $entries[$name] = (string) $zip->getFromIndex($i);
    }

    $zip->close();

    return $entries;
}
