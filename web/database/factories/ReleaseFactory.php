<?php

namespace Database\Factories;

use App\Enums\ReleaseChannel;
use App\Enums\ReleasePlatform;
use App\Enums\ReleaseSource;
use App\Models\Release;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Release>
 */
class ReleaseFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'version_name' => '0.'.fake()->unique()->numberBetween(3, 999).'.0',
            'version_code' => fake()->numberBetween(1, 500),
            'platform' => ReleasePlatform::Android,
            'channel' => ReleaseChannel::Lan,
            'apk_sha256' => strtoupper(hash('sha256', fake()->uuid())),
            'notes' => 'Testbuild.',
            'released_at' => now(),
            'source' => ReleaseSource::Manual,
        ];
    }
}
