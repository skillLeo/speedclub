<?php

namespace Database\Factories;

use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Models\User;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * Hashing once per hashing configuration keeps large fixtures and demo seeds fast, whichever hash driver is configured. A test
     * that raises the cost must not leave a hash behind that the `hashed` cast of a later test, back at the testing cost, refuses.
     */
    protected static ?string $password = null;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::password(),
            'username' => fake()->unique()->regexify('[a-z][a-z0-9]{7,15}'),
            'display_name' => fake()->name(),
            'city' => fake()->city(),
            'terms_version' => '1',
            'privacy_version' => '1',
            'consented_at' => now(),
            'remember_token' => Str::random(10),
        ];
    }

    protected static function password(): string
    {
        if (static::$password === null || Hash::needsRehash(static::$password)) {
            static::$password = Hash::make('password');
        }

        return static::$password;
    }

    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => ['email_verified_at' => null]);
    }

    /**
     * Fresh from registration: no username, no profile yet.
     */
    public function registered(): static
    {
        return $this->state(fn (array $attributes) => ['email_verified_at' => null, 'username' => null, 'display_name' => null, 'city' => null]);
    }

    public function suspended(?DateTimeInterface $until = null): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => UserStatus::Suspended,
            'restrictions' => ['suspension' => ['until' => $until?->format(DATE_ATOM)]],
        ]);
    }

    public function deactivated(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => UserStatus::Deactivated,
            'deletion_requested_at' => now(),
        ]);
    }

    public function restrictedFrom(RestrictionType $type, ?DateTimeInterface $until = null): static
    {
        return $this->state(fn (array $attributes) => [
            'restrictions' => [$type->value => ['until' => $until?->format(DATE_ATOM)]],
        ]);
    }
}
