<?php

namespace Database\Factories;

use App\Models\Conversation;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A bare conversation row. Tests build real conversations through App\Actions\Messaging (or msgConversation() in the helpers), which
 * also write the participants and the first message.
 *
 * @extends Factory<Conversation>
 */
class ConversationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'pair_key' => fn () => Conversation::pairKey(User::factory()->create(), User::factory()->create()),
            'created_by' => null,
            'vehicle_id' => null,
            'last_message_id' => null,
            'last_message_at' => null,
        ];
    }
}
