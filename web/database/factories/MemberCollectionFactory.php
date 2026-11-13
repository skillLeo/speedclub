<?php

namespace Database\Factories;

use App\Models\MemberCollection;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MemberCollection>
 */
class MemberCollectionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'name' => 'Japan-Builds',
            'is_default' => false,
            'position' => 1,
        ];
    }

    /**
     * "Gespeichert", the member's default collection.
     */
    public function default(): static
    {
        return $this->state(fn (): array => ['name' => null, 'is_default' => true, 'position' => 0]);
    }
}
