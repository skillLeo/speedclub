<?php

namespace Database\Factories;

use App\Models\CatalogRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogRequest>
 */
class CatalogRequestFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'make_text' => 'Wiesmann',
            'model_text' => 'MF5',
        ];
    }
}
