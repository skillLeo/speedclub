<?php

namespace Database\Factories;

use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A member's report of a profile, in an open case.
 *
 * @extends Factory<Report>
 */
class ReportFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'reporter_id' => User::factory(),
            'case_id' => ModerationCase::factory(),
            'source' => ReportSource::App,
            'target_type' => fn (array $attributes) => ModerationCase::query()->whereKey($attributes['case_id'])->value('target_type'),
            'target_id' => fn (array $attributes) => ModerationCase::query()->whereKey($attributes['case_id'])->value('target_id'),
            'target_label' => '@'.fake()->userName(),
            'reason' => ReportReason::Spam,
            'good_faith' => false,
        ];
    }
}
