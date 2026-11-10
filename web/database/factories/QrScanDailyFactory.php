<?php

namespace Database\Factories;

use App\Models\QrCode;
use App\Models\QrScanDaily;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<QrScanDaily>
 */
class QrScanDailyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'qr_code_id' => QrCode::factory(),
            'day' => now()->toDateString(),
            'count' => fake()->numberBetween(1, 50),
        ];
    }
}
