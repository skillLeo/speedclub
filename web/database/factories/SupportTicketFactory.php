<?php

namespace Database\Factories;

use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\SupportTicketStatus;
use App\Models\SupportTicket;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SupportTicket>
 */
class SupportTicketFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'source' => SupportTicketSource::App,
            'category' => SupportCategory::Account,
            'subject' => 'Ich komme nicht mehr in mein Konto',
            'status' => SupportTicketStatus::Open,
            'locale' => 'de',
        ];
    }

    public function guest(): static
    {
        return $this->state(fn (): array => [
            'user_id' => null,
            'source' => SupportTicketSource::Web,
            'name' => 'Jana Krüger',
            'email' => fake()->safeEmail(),
        ]);
    }
}
