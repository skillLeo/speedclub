<?php

use App\Models\LoginAttempt;
use App\Models\PasskeyChallenge;

/**
 * M4.18 (09 §13, privacy policy "Wie lange wir Daten speichern"): e-mail codes and magic links go 24 hours after they were made once they
 * are spent or expired, and passkey ceremonies once they expired, in the hourly speedclub:prune-platform. Before, nothing removed them.
 */
it('removes spent and expired e-mail codes after the retention period and keeps everything the limits still count', function () {
    $hours = config()->integer('speedclub.email_code.retention_hours');

    $this->travelTo(now()->subHours($hours + 1));
    $spent = LoginAttempt::factory()->create(['consumed_at' => now()]);
    $expired = LoginAttempt::factory()->create(['expires_at' => now()->addMinutes(10)]);
    $this->travelBack();

    $this->travelTo(now()->subHours($hours - 1));
    $recent = LoginAttempt::factory()->create(['consumed_at' => now()]);
    $this->travelBack();

    $open = LoginAttempt::factory()->create();

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(LoginAttempt::query()->whereKey($spent->id)->exists())->toBeFalse()
        ->and(LoginAttempt::query()->whereKey($expired->id)->exists())->toBeFalse()
        ->and(LoginAttempt::query()->whereKey($recent->id)->exists())->toBeTrue()
        ->and(LoginAttempt::query()->whereKey($open->id)->exists())->toBeTrue();
});

it('removes expired passkey ceremonies and keeps live ones', function () {
    $old = PasskeyChallenge::factory()->create(['expires_at' => now()->subHours(2)]);
    $justExpired = PasskeyChallenge::factory()->create(['expires_at' => now()->subMinute()]);
    $live = PasskeyChallenge::factory()->create();

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(PasskeyChallenge::query()->whereKey($old->id)->exists())->toBeFalse()
        ->and(PasskeyChallenge::query()->whereKey($justExpired->id)->exists())->toBeFalse()
        ->and(PasskeyChallenge::query()->whereKey($live->id)->exists())->toBeTrue();
});
