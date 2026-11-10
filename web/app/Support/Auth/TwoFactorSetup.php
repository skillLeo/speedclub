<?php

namespace App\Support\Auth;

/**
 * SET-05 step 1: what the authenticator app needs. Shown once, never cached (Cache-Control: no-store).
 */
final readonly class TwoFactorSetup
{
    public function __construct(
        public string $secret,
        public string $otpauthUrl,
        public string $qrSvg,
    ) {}
}
