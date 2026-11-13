<?php

namespace App\Services\Auth\IdTokens;

use App\Enums\SocialProvider;

/**
 * What a verified ID token says: the provider's subject and, when present, the address and whether the provider verified it. Apple
 * private relay addresses are valid addresses (09 §8.1).
 */
final readonly class VerifiedIdentity
{
    public function __construct(
        public SocialProvider $provider,
        public string $subject,
        public ?string $email,
        public bool $emailVerified,
        public bool $privateRelay,
        public ?string $audience = null,
    ) {}
}
