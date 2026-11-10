<?php

namespace App\Support\Auth;

/**
 * The password (or e-mail code) was right, and the account has two-factor: no session or token yet (AUTH-11). The client sends the
 * challenge with a code to POST auth/two-factor/challenge within expiresIn seconds.
 */
final readonly class TwoFactorPending
{
    public function __construct(
        public string $challenge,
        public int $expiresIn,
    ) {}
}
