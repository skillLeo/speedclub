<?php

namespace Database\Factories;

use App\Enums\AppealStatus;
use App\Enums\DecisionViewer;
use App\Models\Appeal;
use App\Models\Decision;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open appeal of the affected member.
 *
 * @extends Factory<Appeal>
 */
class AppealFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'decision_id' => Decision::factory(),
            'appellant_id' => fn (array $attributes) => Decision::query()->whereKey($attributes['decision_id'])->value('subject_id'),
            'role' => DecisionViewer::Affected,
            'text' => 'Das war kein Spam, sondern ein Hinweis auf mein eigenes Teilegutachten.',
            'status' => AppealStatus::Open,
        ];
    }
}
