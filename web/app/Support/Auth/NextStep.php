<?php

namespace App\Support\Auth;

use App\Enums\AuthNextStep;

/**
 * The neutral answer of register, resend, forgot and reset. It only holds what the client sent and fixed values.
 */
final readonly class NextStep
{
    public function __construct(
        public AuthNextStep $next,
        public string $email,
        public ?int $resendAfterSeconds = null,
        public int $status = 202,
    ) {}

    public static function afterCodeRequest(AuthNextStep $next, string $email): self
    {
        return new self($next, $email, config()->integer('speedclub.verification.resend_cooldown_seconds'));
    }
}
