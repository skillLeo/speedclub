<?php

namespace Database\Factories;

use App\Enums\CaseOrigin;
use App\Enums\CaseStatus;
use App\Enums\ReportTargetType;
use App\Models\ModerationCase;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open case about a member's profile. Tests that need a real target use App\Actions\Moderation\SubmitReport instead.
 *
 * @extends Factory<ModerationCase>
 */
class ModerationCaseFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'target_type' => ReportTargetType::Member,
            'target_id' => fn (array $attributes) => $attributes['subject_id'],
            'subject_id' => User::factory(),
            'open_target' => fn (array $attributes) => ModerationCase::openKey(ReportTargetType::Member, (string) $attributes['subject_id']),
            'origin' => CaseOrigin::Report,
            'status' => CaseStatus::New,
            'priority' => 5,
            'report_count' => 1,
        ];
    }

    /** An own-initiative case (M3.2): staff opened it, no report. */
    public function ownInitiative(): static
    {
        return $this->state(['origin' => CaseOrigin::Staff, 'report_count' => 0, 'priority' => 0]);
    }

    public function decided(): static
    {
        return $this->state(['status' => CaseStatus::Decided, 'open_target' => null, 'decided_at' => now()]);
    }
}
