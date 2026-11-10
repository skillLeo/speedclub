<?php

namespace App\Support\Auth;

use App\Models\User;
use DateTimeInterface;

/**
 * A finished sign-in. Without a token the member signed in on the cookie session.
 */
final readonly class AuthResult
{
    public function __construct(
        public User $user,
        public ?string $token = null,
        public ?DateTimeInterface $tokenExpiresAt = null,
    ) {}
}
