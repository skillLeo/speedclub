<?php

namespace Database\Factories;

use App\Enums\ForumCategoryKind;
use App\Models\ForumCategory;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<ForumCategory>
 */
class ForumCategoryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = 'Fahrwerk '.Str::lower(Str::random(6));

        return [
            'parent_id' => null,
            'slug' => Str::slug($name),
            'kind' => ForumCategoryKind::Standard,
            'name_de' => $name,
            'name_en' => 'Suspension '.Str::lower(Str::random(4)),
            'description_de' => 'Federn, Dämpfer, Gewindefahrwerk und Achsvermessung.',
            'description_en' => 'Springs, dampers, coilovers and alignment.',
            'icon' => null,
            'sort' => 0,
            'is_active' => true,
        ];
    }

    public function childOf(ForumCategory $parent): static
    {
        return $this->state(fn (): array => ['parent_id' => $parent->id]);
    }

    public function inactive(): static
    {
        return $this->state(fn (): array => ['is_active' => false]);
    }
}
