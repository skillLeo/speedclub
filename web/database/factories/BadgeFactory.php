<?php

namespace Database\Factories;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Models\Badge;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Badge>
 */
class BadgeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'badge-'.fake()->unique()->lexify('??????'),
            'name_de' => 'Erster Build',
            'name_en' => 'First build',
            'description_de' => 'Du hast deinen ersten Build veröffentlicht.',
            'description_en' => 'You published your first build.',
            'hint_de' => null,
            'hint_en' => null,
            'rule_json' => ['metric' => 'published_vehicles', 'gte' => 1],
            'hidden' => false,
            'tier' => BadgeTier::Bronze,
            'category' => BadgeCategory::Garage,
            'sort' => 0,
            'active' => true,
        ];
    }

    public function hidden(string $hintDe = 'Mach dein Ding.', string $hintEn = 'Do your thing.'): static
    {
        return $this->state(fn (array $attributes) => ['hidden' => true, 'hint_de' => $hintDe, 'hint_en' => $hintEn]);
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes) => ['active' => false]);
    }
}
