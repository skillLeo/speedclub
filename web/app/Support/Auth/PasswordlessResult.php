<?php

namespace App\Support\Auth;

use App\Enums\SignInNext;

/**
 * A finished passwordless sign-in: the session or token, whether the account was created just now, and the next screen.
 */
final readonly class PasswordlessResult
{
    public function __construct(
        public AuthResult $session,
        public bool $isNew,
    ) {}

    public function next(): SignInNext
    {
        return SignInNext::fromStep($this->session->user->onboardingStep());
    }
}
