<?php

namespace Database\Factories;

use App\Models\MessageTemplate;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<MessageTemplate>
 */
class MessageTemplateFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => 'mail.support_received',
            'locale' => 'de',
            'fields' => ['subject' => 'Wir haben deine Anfrage erhalten'],
        ];
    }
}
