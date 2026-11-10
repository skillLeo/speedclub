<?php

namespace Database\Factories;

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Default is an unpublished draft.
 *
 * @extends Factory<LegalDocument>
 */
class LegalDocumentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => LegalDocumentKey::Terms,
            'locale' => 'de',
            'version' => fake()->unique()->numerify('#####'),
            'body_md' => "# AGB\n\nEntwurf.",
        ];
    }

    public function published(): static
    {
        return $this->state(fn (array $attributes) => ['published_at' => now()->subMinute()]);
    }
}
