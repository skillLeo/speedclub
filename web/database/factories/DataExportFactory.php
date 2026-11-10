<?php

namespace Database\Factories;

use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<DataExport>
 */
class DataExportFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'status' => DataExportStatus::Queued,
            'requested_at' => now(),
        ];
    }

    public function ready(): static
    {
        return $this->state(fn (): array => [
            'status' => DataExportStatus::Ready,
            'ready_at' => now(),
            'expires_at' => now()->addDays(7),
            'path' => 'exports/'.fake()->uuid().'.zip',
        ]);
    }
}
