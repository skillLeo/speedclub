<?php

namespace Database\Factories;

use App\Models\Business;
use App\Models\BusinessInvite;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * An open team invitation (SEC-414-01), sent by the business's owner.
 *
 * @extends Factory<BusinessInvite>
 */
class BusinessInviteFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'business_id' => Business::factory(),
            'user_id' => User::factory(),
            'invited_by' => fn (array $attributes): ?string => Business::query()->whereKey($attributes['business_id'])->value('owner_id'),
        ];
    }
}
