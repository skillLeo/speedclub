<?php

namespace Database\Factories;

use App\Enums\ConversationFolder;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConversationParticipant>
 */
class ConversationParticipantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'conversation_id' => Conversation::factory(),
            'user_id' => User::factory(),
            'folder' => ConversationFolder::Chats,
            'accepted_at' => now(),
            'unread_count' => 0,
        ];
    }

    public function request(): static
    {
        return $this->state(['folder' => ConversationFolder::Requests, 'accepted_at' => null]);
    }
}
