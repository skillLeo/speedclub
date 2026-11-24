<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Wrapped;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A generated Wrapped of the 2027 season with the two cards every Wrapped has (intro, share without a car). Tests that care about the
 * cards generate them (WrappedGenerator).
 *
 * @extends Factory<Wrapped>
 */
class WrappedFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'season_key' => '2027-saison',
            'payload' => [
                'v' => 1,
                'season_key' => '2027-saison',
                'cards' => [
                    ['kind' => 'intro', 'year' => 2027, 'season' => 'saison'],
                ],
            ],
            'is_sample' => false,
            'generated_at' => now(),
            'viewed_at' => null,
            'shared_count' => 0,
        ];
    }

    public function season(string $key): static
    {
        return $this->state(fn (array $attributes): array => [
            'season_key' => $key,
            'payload' => [...(is_array($attributes['payload'] ?? null) ? $attributes['payload'] : []), 'season_key' => $key],
        ]);
    }
}
