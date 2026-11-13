<?php

namespace App\Support\Auth;

/**
 * The neutral answer of an e-mail code request (09 §8.1): what the client sent and the wait before the next code, nothing about the
 * account.
 */
final readonly class EmailCodeStarted
{
    public function __construct(
        public string $attemptId,
        public int $resendAfter,
    ) {}
}
