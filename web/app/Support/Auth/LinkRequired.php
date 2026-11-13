<?php

namespace App\Support\Auth;

use App\Enums\SocialProvider;

/**
 * AUTH-16 (09 §8.1): the provider's address belongs to an existing verified account, which is never linked automatically. A code went to
 * that address; POST auth/link/confirm with attempt_id and the code links and signs in.
 */
final readonly class LinkRequired
{
    public function __construct(
        public SocialProvider $provider,
        public string $attemptId,
        public string $emailHint,
        public int $resendAfter,
    ) {}
}
