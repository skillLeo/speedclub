<?php

namespace Database\Factories;

use App\Models\HelpArticle;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<HelpArticle>
 */
class HelpArticleFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => fake()->unique()->slug(2),
            'locale' => 'de',
            'title' => 'Wie funktioniert der QR-Sticker?',
            'body_md' => "Der Sticker führt zur öffentlichen Seite deines Builds.\n\n- Scannen\n- Ansehen",
            'sort' => fake()->numberBetween(1, 100),
            'published' => true,
        ];
    }
}
