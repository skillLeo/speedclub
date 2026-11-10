<?php

namespace Database\Factories;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Support\Codes;
use App\Support\Slug;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default is a draft, like the database default. Use published() for a vehicle others can see.
 *
 * @extends Factory<Vehicle>
 */
class VehicleFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $publicId = Codes::generate();

        return [
            'owner_id' => User::factory(),
            'public_id' => $publicId,
            'make_id' => Make::factory(),
            'model_id' => fn (array $attributes) => VehicleModel::factory()->state(['make_id' => $attributes['make_id']]),
            'generation_id' => fn (array $attributes) => Generation::factory()->state(['model_id' => $attributes['model_id']]),
            'slug' => fn (array $attributes) => Slug::forVehicle(
                Make::query()->whereKey($attributes['make_id'])->value('name'),
                VehicleModel::query()->whereKey($attributes['model_id'])->value('name'),
                Generation::query()->whereKey($attributes['generation_id'])->value('name'),
                $publicId,
            ),
            'model_year' => fake()->numberBetween(1990, 2026),
        ];
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => VehicleStatus::Published,
            'published_at' => now(),
        ]);
    }

    public function unlisted(): static
    {
        return $this->published()->state(fn (array $attributes) => ['visibility' => Visibility::Unlisted]);
    }

    public function private(): static
    {
        return $this->published()->state(fn (array $attributes) => ['visibility' => Visibility::Private]);
    }

    public function archived(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => VehicleStatus::Archived,
            'published_at' => now()->subDay(),
            'archived_at' => now(),
        ]);
    }
}
