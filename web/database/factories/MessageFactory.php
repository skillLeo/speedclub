<?php

namespace Database\Factories;

use App\Enums\MessageType;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A bare message row: it does not move the conversation's last message or anybody's unread count (App\Actions\Messaging does).
 *
 * @extends Factory<Message>
 */
class MessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'conversation_id' => Conversation::factory(),
            'sender_id' => User::factory(),
            'client_id' => fn () => (string) Str::uuid(),
            'type' => MessageType::Text,
            'body' => 'Wie fährt sich das neue Fahrwerk?',
        ];
    }
}
