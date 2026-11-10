<?php

namespace Database\Factories;

use App\Enums\MessageReaction;
use App\Models\Message;
use App\Models\MessageReactionRow;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MessageReactionRow>
 */
class MessageReactionRowFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'message_id' => Message::factory(),
            'user_id' => User::factory(),
            'reaction' => MessageReaction::Fire,
        ];
    }
}
