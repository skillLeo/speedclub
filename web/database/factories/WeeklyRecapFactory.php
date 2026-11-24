<?php

namespace Database\Factories;

use App\Enums\RecapStatus;
use App\Models\User;
use App\Models\WeeklyRecap;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<WeeklyRecap>
 */
class WeeklyRecapFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'week' => now('Europe/Berlin')->startOfWeek(CarbonInterface::MONDAY)->toDateString(),
            'status' => RecapStatus::Sent,
            'channels' => ['push'],
            'payload' => ['views' => 1],
            'created_at' => now(),
        ];
    }
}
