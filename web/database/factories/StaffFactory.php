<?php

namespace Database\Factories;

use App\Enums\StaffStatus;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use PragmaRX\Google2FA\Google2FA;

/**
 * @extends Factory<Staff>
 */
class StaffFactory extends Factory
{
    /**
     * Hashed once per hashing configuration: a test that raises the cost (StaffResetTimingTest) must not leave a hash behind that
     * the `hashed` cast of a later test, back at the testing cost, refuses.
     */
    protected static ?string $password = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'password' => static::password(),
            'status' => StaffStatus::Active,
        ];
    }

    protected static function password(): string
    {
        if (static::$password === null || Hash::needsRehash(static::$password)) {
            static::$password = Hash::make('password-for-tests');
        }

        return static::$password;
    }

    public function suspended(): static
    {
        return $this->state(['status' => StaffStatus::Suspended]);
    }

    /** Enrolled in TOTP the way Fortify stores it, so the account passes EnsureStaffTwoFactor. */
    public function twoFactorConfirmed(): static
    {
        return $this->state(fn (): array => [
            'two_factor_secret' => encrypt(app(Google2FA::class)->generateSecretKey()),
            'two_factor_recovery_codes' => encrypt((string) json_encode(array_map(fn (): string => Str::random(10).'-'.Str::random(10), range(1, 8)))),
            'two_factor_confirmed_at' => now(),
        ]);
    }
}
