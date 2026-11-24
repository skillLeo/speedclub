<?php

namespace Database\Factories;

use App\Models\ViewSalt;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ViewSalt>
 */
class ViewSaltFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'day' => now('Europe/Berlin')->toDateString(),
            'salt' => bin2hex(random_bytes(32)),
            'created_at' => now(),
        ];
    }
}
