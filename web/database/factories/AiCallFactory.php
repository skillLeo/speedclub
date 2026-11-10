<?php

namespace Database\Factories;

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Models\AiCall;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AiCall>
 */
class AiCallFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'feature' => AiFeature::Translate,
            'provider' => 'anthropic',
            'model' => 'claude-haiku-5-5',
            'latency_ms' => 640,
            'input_tokens' => 210,
            'output_tokens' => 48,
            'outcome' => AiOutcome::Ok,
        ];
    }
}
