<?php

namespace Database\Factories;

use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Support\Codes;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<QrCode>
 */
class QrCodeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'vehicle_id' => Vehicle::factory()->published(),
            'code' => Codes::generate(),
        ];
    }

    public function revoked(QrRevocationReason $reason = QrRevocationReason::Reissued): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => QrStatus::Revoked,
            'revoked_at' => now(),
            'revoked_reason' => $reason,
        ]);
    }
}
