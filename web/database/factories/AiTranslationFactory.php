<?php

namespace Database\Factories;

use App\Enums\TranslationSource;
use App\Models\AiTranslation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<AiTranslation>
 */
class AiTranslationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'source_type' => TranslationSource::VehicleDescription,
            'source_id' => strtolower((string) Str::ulid()),
            'to' => 'en',
            'source_hash' => hash('sha256', 'Tiefer, breiter, lauter.'),
            'text' => 'Lower, wider, louder.',
            'expires_at' => now()->addDays(30),
        ];
    }
}
