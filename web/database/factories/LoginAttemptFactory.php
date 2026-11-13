<?php

namespace Database\Factories;

use App\Enums\LoginPurpose;
use App\Models\LoginAttempt;
use App\Services\Auth\EmailCodes;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * An open sign-in code for fake@example.test with the code 123456 and the attempt id of attemptId(). Real rows come from EmailCodes only.
 *
 * @extends Factory<LoginAttempt>
 */
class LoginAttemptFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $attempt = (string) Str::uuid();

        return [
            'email_hash' => EmailCodes::emailHash($this->faker->unique()->safeEmail()),
            'attempt_hash' => EmailCodes::attemptHash($attempt),
            'purpose' => LoginPurpose::SignIn,
            'code_hash' => EmailCodes::codeHash($attempt, '123456'),
            'expires_at' => now()->addMinutes(10),
        ];
    }
}
