<?php

namespace App\Support\Auth;

use App\Enums\SocialProvider;
use App\Services\Auth\IdTokens\VerifiedIdentity;

/**
 * The provider identity an AUTH-16 link carries: in the login_attempts payload until the code is right, then, on an account with
 * two-factor on, inside the encrypted challenge until the second factor passed (SEC-M46-02).
 */
final class PendingProviderLink
{
    /**
     * @param  array<array-key, mixed>  $payload
     */
    public static function identity(array $payload): ?VerifiedIdentity
    {
        $provider = SocialProvider::tryFrom(is_string($payload['provider'] ?? null) ? $payload['provider'] : '');
        $sub = $payload['sub'] ?? null;

        if ($provider === null || ! is_string($sub) || $sub === '') {
            return null;
        }

        $email = $payload['email'] ?? null;
        $audience = $payload['audience'] ?? null;

        return new VerifiedIdentity(
            $provider,
            $sub,
            is_string($email) ? $email : null,
            ($payload['email_verified'] ?? false) === true,
            ($payload['private_relay'] ?? false) === true,
            is_string($audience) ? $audience : null,
        );
    }

    /**
     * @param  array<array-key, mixed>  $payload
     */
    public static function authorizationCode(array $payload): ?string
    {
        $code = $payload['authorization_code'] ?? null;

        return is_string($code) && $code !== '' ? $code : null;
    }

    /**
     * Only what the link needs, for the challenge.
     *
     * @param  array<array-key, mixed>  $payload
     * @return array<string, mixed>
     */
    public static function carry(array $payload): array
    {
        return array_intersect_key($payload, array_flip(['provider', 'sub', 'email', 'email_verified', 'private_relay', 'audience', 'authorization_code']));
    }
}
