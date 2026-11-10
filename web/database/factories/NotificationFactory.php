<?php

namespace Database\Factories;

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A security row by default: it has no actor, so it shows whoever reads it. Real rows come from Notifier.
 *
 * @extends Factory<Notification>
 */
class NotificationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'type' => NotificationType::Security,
            'notifiable_type' => 'user',
            'notifiable_id' => User::factory(),
            'group_key' => null,
            'actor_count' => 0,
            'data' => ['event' => 'new_device', 'device_name' => 'iPhone'],
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    public function forRecipient(User $recipient): static
    {
        return $this->state(fn (): array => ['notifiable_id' => $recipient->id]);
    }

    public function read(): static
    {
        return $this->state(fn (): array => ['read_at' => now()]);
    }
}
