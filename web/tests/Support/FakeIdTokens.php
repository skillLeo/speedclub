<?php

namespace Tests\Support;

use App\Enums\SocialProvider;
use App\Services\Auth\IdTokens\IdTokenNonces;
use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Http;
use OpenSSLAsymmetricKey;
use RuntimeException;

/**
 * A local stand-in for Apple's and Google's JWKS (09 §8.1 "unit tests use a local fake JWKS"): an RSA key pair per provider, the public
 * half served by Http::fake at the configured jwks_url, and ID tokens signed with the private half (or with anything a test needs to
 * break).
 */
final class FakeIdTokens
{
    public const APPLE_AUD = 'de.speedclub.app';

    public const GOOGLE_AUD = '1234567890-web.apps.googleusercontent.com';

    /** @var array<string, OpenSSLAsymmetricKey> */
    private static array $keys = [];

    public static int $jwksRequests = 0;

    /** SEC-M46-06: while true both key endpoints answer 503 (still counted in $jwksRequests). */
    public static bool $jwksDown = false;

    /** The server nonce of the last google() token without a nonce override, or of the last serverNonce() (SEC-M46-05). */
    public static ?string $lastNonce = null;

    /**
     * Configures both providers and fakes their key endpoints. $kids lists the kids each JWKS publishes.
     *
     * @param  list<string>  $kids
     */
    public static function install(array $kids = ['test-kid']): void
    {
        self::$jwksRequests = 0;
        self::$jwksDown = false;
        config([
            'services.apple.client_ids' => [self::APPLE_AUD, 'de.speedclub.web'],
            'services.google.client_ids' => [self::GOOGLE_AUD],
            'services.apple.private_key_path' => null,
        ]);

        $jwks = ['keys' => array_map(fn (string $kid): array => self::jwk($kid), $kids)];

        Http::fake([
            'appleid.apple.com/auth/keys' => function () use ($jwks) {
                self::$jwksRequests++;

                return self::$jwksDown ? Http::response('down', 503) : Http::response($jwks);
            },
            'www.googleapis.com/oauth2/v3/certs' => function () use ($jwks) {
                self::$jwksRequests++;

                return self::$jwksDown ? Http::response('down', 503) : Http::response($jwks);
            },
        ]);
    }

    /**
     * @param  array<string, mixed>  $overrides  null removes a claim
     */
    public static function apple(string $rawNonce, array $overrides = [], string $kid = 'test-kid', string $alg = 'RS256'): string
    {
        return self::sign([
            'iss' => 'https://appleid.apple.com',
            'aud' => self::APPLE_AUD,
            'exp' => time() + 600,
            'iat' => time(),
            'sub' => '001234.abcdef0123456789.1234',
            'email' => 'lena@beispiel.test',
            'email_verified' => true,
            'nonce' => hash('sha256', $rawNonce),
            ...$overrides,
        ], $kid, $alg);
    }

    /**
     * A nonce as POST auth/nonce issues it (single use, bound to the provider).
     */
    public static function serverNonce(SocialProvider $provider): string
    {
        return self::$lastNonce = app(IdTokenNonces::class)->issue($provider);
    }

    /**
     * The request fields of a Google sign-in or link: a token carrying a fresh server nonce, and that nonce.
     *
     * @param  array<string, mixed>  $overrides
     * @return array{id_token: string}&array<string, string>
     */
    public static function googleInput(array $overrides = [], string $nonceField = 'nonce'): array
    {
        $token = self::google($overrides);

        return ['id_token' => $token, $nonceField => (string) self::$lastNonce];
    }

    /**
     * Without a `nonce` override the token carries a fresh server nonce (self::$lastNonce).
     *
     * @param  array<string, mixed>  $overrides
     */
    public static function google(array $overrides = [], string $kid = 'test-kid', string $alg = 'RS256'): string
    {
        if (! array_key_exists('nonce', $overrides)) {
            $overrides['nonce'] = self::serverNonce(SocialProvider::Google);
        }

        return self::sign([
            'iss' => 'https://accounts.google.com',
            'aud' => self::GOOGLE_AUD,
            'exp' => time() + 3600,
            'iat' => time(),
            'sub' => '109876543210987654321',
            'email' => 'lena@beispiel.test',
            'email_verified' => true,
            ...$overrides,
        ], $kid, $alg);
    }

    /**
     * An unsigned token with alg "none".
     *
     * @param  array<string, mixed>  $claims
     */
    public static function unsigned(array $claims, string $kid = 'test-kid'): string
    {
        return JWT::urlsafeB64Encode((string) json_encode(['alg' => 'none', 'typ' => 'JWT', 'kid' => $kid]))
            .'.'.JWT::urlsafeB64Encode((string) json_encode($claims)).'.';
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    private static function sign(array $claims, string $kid, string $alg): string
    {
        $claims = array_filter($claims, fn (mixed $value): bool => $value !== null);

        if ($alg === 'HS256') {
            // Signed with the public key's PEM as an HMAC secret: the classic algorithm-confusion attack.
            $details = openssl_pkey_get_details(self::key($kid));

            return JWT::encode($claims, (string) ($details['key'] ?? ''), 'HS256', $kid);
        }

        openssl_pkey_export(self::key($kid), $pem);

        return JWT::encode($claims, (string) $pem, $alg, $kid);
    }

    /**
     * @return array<string, string>
     */
    private static function jwk(string $kid): array
    {
        $details = openssl_pkey_get_details(self::key($kid));

        if ($details === false || ! isset($details['rsa']['n'], $details['rsa']['e'])) {
            throw new RuntimeException('No RSA key.');
        }

        return [
            'kty' => 'RSA',
            'kid' => $kid,
            'use' => 'sig',
            'alg' => 'RS256',
            'n' => JWT::urlsafeB64Encode($details['rsa']['n']),
            'e' => JWT::urlsafeB64Encode($details['rsa']['e']),
        ];
    }

    private static function key(string $kid): OpenSSLAsymmetricKey
    {
        if (! isset(self::$keys[$kid])) {
            $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);

            if ($key === false) {
                throw new RuntimeException('No RSA key.');
            }

            self::$keys[$kid] = $key;
        }

        return self::$keys[$kid];
    }
}
