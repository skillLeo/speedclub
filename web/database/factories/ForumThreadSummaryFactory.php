<?php

namespace Database\Factories;

use App\Models\ForumThread;
use App\Models\ForumThreadSummary;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ForumThreadSummary>
 */
class ForumThreadSummaryFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'thread_id' => ForumThread::factory(),
            'lines' => ['Es geht um die Abstimmung eines Gewindefahrwerks.', 'Mehrere empfehlen eine Achsvermessung danach.', 'Gelöst wurde es mit weicherer Dämpfung.'],
            'based_on_replies' => 21,
            'post_ids' => [],
            'author_ids' => [],
            'ai_call_id' => null,
            'generated_at' => now(),
        ];
    }
}
