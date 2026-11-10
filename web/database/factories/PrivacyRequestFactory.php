<?php

namespace Database\Factories;

use App\Enums\PrivacyRequestSource;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Models\PrivacyRequest;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PrivacyRequest>
 */
class PrivacyRequestFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $received = now()->subDays(3);

        return [
            'type' => PrivacyRequestType::Access,
            'status' => PrivacyRequestStatus::Open,
            'source' => PrivacyRequestSource::Email,
            'requester_name' => fake()->name(),
            'requester_email' => fake()->unique()->safeEmail(),
            'locale' => 'de',
            'details' => 'Bitte um Auskunft über alle gespeicherten Daten.',
            'received_at' => $received,
            'due_at' => $received->copy()->addMonthNoOverflow(),
        ];
    }
}
