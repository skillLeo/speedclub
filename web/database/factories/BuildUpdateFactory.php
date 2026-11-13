<?php

namespace Database\Factories;

use App\Enums\BuildUpdateType;
use App\Models\BuildUpdate;
use App\Models\Vehicle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<BuildUpdate>
 */
class BuildUpdateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory(),
            'type' => BuildUpdateType::ModAdded,
            'payload' => ['before' => 'Serie', 'after' => 'KW V3'],
        ];
    }

    /**
     * M4.11: an update the owner posted (UPD-01).
     */
    public function post(string $text = 'Neues Fahrwerk eingetragen, fährt sich wie auf Schienen.'): static
    {
        return $this->state(fn (): array => ['type' => BuildUpdateType::Post, 'payload' => null, 'note' => $text]);
    }
}
