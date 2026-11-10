<?php

namespace Database\Factories;

use App\Enums\VerificationPurpose;
use App\Models\User;
use App\Models\VerificationCode;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<VerificationCode>
 */
class VerificationCodeFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'purpose' => VerificationPurpose::EmailVerification,
            'code_hash' => Hash::make('123456'),
            'expires_at' => now()->addMinutes(10),
        ];
    }
}
