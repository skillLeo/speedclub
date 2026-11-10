<?php

namespace Database\Factories;

use App\Models\Staff;
use App\Models\StaffInvitation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<StaffInvitation>
 */
class StaffInvitationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'staff_id' => Staff::factory()->state(['password_proof_required' => true]),
            'token_hash' => hash('sha256', Str::random(64)),
            'expires_at' => now()->addHours(72),
        ];
    }
}
