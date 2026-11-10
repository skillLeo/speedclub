<?php

namespace Database\Factories;

use App\Enums\TicketAuthorType;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<TicketMessage>
 */
class TicketMessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'ticket_id' => SupportTicket::factory(),
            'author_type' => TicketAuthorType::Member,
            'body' => 'Seit gestern kann ich mich nicht mehr anmelden.',
        ];
    }
}
