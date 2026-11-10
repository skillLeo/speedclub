<?php

namespace Database\Factories;

use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\RedressOption;
use App\Models\Decision;
use App\Models\ModerationCase;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A remove_content decision of a decided case, notified now. Real decisions come from App\Actions\Moderation\DecideCase.
 *
 * @extends Factory<Decision>
 */
class DecisionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'case_id' => ModerationCase::factory()->decided(),
            'subject_id' => fn (array $attributes) => ModerationCase::query()->whereKey($attributes['case_id'])->value('subject_id'),
            'action' => DecisionAction::RemoveContent,
            'restriction' => null,
            'statement_of_reasons' => [
                'facts' => 'Das Profil enthielt Werbung für einen fremden Shop.',
                'ground' => 'Community-Richtlinien §6 (Kein Spam)',
                'ground_document' => GroundDocument::Community->value,
                'ground_section' => '6',
                'automated' => false,
                'redress' => array_map(fn (RedressOption $option): string => $option->value, RedressOption::cases()),
            ],
            'decided_at' => now(),
            'notified_at' => now(),
        ];
    }
}
