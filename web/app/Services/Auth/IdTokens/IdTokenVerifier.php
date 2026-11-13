<?php

namespace App\Services\Auth\IdTokens;

use App\Enums\ErrorCode;
use App\Enums\SocialProvider;
use App\Exceptions\ApiException;
use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * One verifier for Apple and Google ID tokens (09 §8.1, ADR-408) on firebase/php-jwt: JWK::parseKeySet + JWT::decode against the
 * provider's JWKS, cached 6 hours and fetched again once when a token names an unknown kid. Checks, in order: RS256 only (the header and
 * every key; "none" and HS* never reach a key), signature, exp (by the library), iat no more than 5 minutes ahead and no older than an
 * hour, iss, aud among the configured client IDs, the nonce (a server-issued one of IdTokenNonces, spent here; Apple: the token holds
 * its SHA-256 hex; Google: the raw value or its SHA-256 hex), a subject, and for Google email_verified = true. Every failure is the same
 * 401 invalid_identity_token; the log names only the provider and the check, never the token.
 *
 * SEC-M46-06: the last good JWKS stays in use while a refetch fails; a failed fetch is not tried again for a minute.
 */
final class IdTokenVerifier
{
    public function __construct(private readonly IdTokenNonces $nonces) {}

    public function verify(SocialProvider $provider, string $jwt, ?string $rawNonce): VerifiedIdentity
    {
        $audiences = $this->audiences($provider);

        if ($audiences === []) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        $header = $this->header($jwt);

        if (($header['alg'] ?? null) !== 'RS256') {
            throw $this->fail($provider, 'alg');
        }

        $kid = $header['kid'] ?? null;

        if (! is_string($kid) || $kid === '') {
            throw $this->fail($provider, 'kid');
        }

        $keys = $this->keys($provider, $kid);

        // The skew of 09 §8.1 for the clocks of phone and provider; restored at once, as the library keeps it in a static.
        $leeway = JWT::$leeway;
        JWT::$leeway = config()->integer('speedclub.id_tokens.iat_skew_seconds');

        try {
            $claims = (array) JWT::decode($jwt, $keys);
        } catch (Throwable $exception) {
            throw $this->fail($provider, class_basename($exception));
        } finally {
            JWT::$leeway = $leeway;
        }

        $now = time();
        $iat = $claims['iat'] ?? null;
        $skew = config()->integer('speedclub.id_tokens.iat_skew_seconds');

        if (! is_numeric($iat) || (int) $iat > $now + $skew || (int) $iat < $now - config()->integer('speedclub.id_tokens.max_age_seconds')) {
            throw $this->fail($provider, 'iat');
        }

        if (! is_numeric($claims['exp'] ?? null)) {
            throw $this->fail($provider, 'exp');
        }

        if (! in_array($claims['iss'] ?? null, $this->issuers($provider), true)) {
            throw $this->fail($provider, 'iss');
        }

        $aud = $claims['aud'] ?? null;
        $audList = is_array($aud) ? $aud : [$aud];

        if (array_intersect($audList, $audiences) === [] || array_filter($audList, fn ($value): bool => ! is_string($value)) !== []) {
            throw $this->fail($provider, 'aud');
        }

        $this->checkNonce($provider, $claims['nonce'] ?? null, $rawNonce);

        $sub = $claims['sub'] ?? null;

        if (! is_string($sub) || $sub === '') {
            throw $this->fail($provider, 'sub');
        }

        $email = isset($claims['email']) && is_string($claims['email']) ? $claims['email'] : null;
        $verified = in_array($claims['email_verified'] ?? null, [true, 'true'], true);

        if ($provider === SocialProvider::Google && (! $verified || $email === null)) {
            throw $this->fail($provider, 'email_verified');
        }

        // Last, so a token that fails another check does not spend the app's nonce. A token can only be used once.
        if (! $this->nonces->consume($provider, (string) $rawNonce)) {
            throw $this->fail($provider, 'nonce_unknown');
        }

        $relay = in_array($claims['is_private_email'] ?? null, [true, 'true'], true)
            || ($email !== null && str_ends_with(mb_strtolower($email), '@privaterelay.appleid.com'));

        $matched = array_values(array_intersect($audList, $audiences));

        return new VerifiedIdentity($provider, $sub, $email, $email !== null && $verified, $provider === SocialProvider::Apple && $relay, $matched[0] ?? null);
    }

    /**
     * @return list<string>
     */
    public function audiences(SocialProvider $provider): array
    {
        $ids = config()->array('services.'.$provider->value.'.client_ids');

        return array_values(array_filter($ids, fn (mixed $id): bool => is_string($id) && $id !== ''));
    }

    /**
     * Apple: the token's nonce is the SHA-256 (hex) of the raw nonce from POST auth/nonce (expo-apple-authentication passes the hashed
     * value to Apple). Google: the raw nonce given to the Google SDK, or its SHA-256 hex. Required for both (SEC-M46-05).
     */
    private function checkNonce(SocialProvider $provider, mixed $claim, ?string $rawNonce): void
    {
        if ($rawNonce === null || $rawNonce === '' || ! is_string($claim)) {
            throw $this->fail($provider, 'nonce');
        }

        $hashed = hash_equals(hash('sha256', $rawNonce), $claim);

        if ($provider === SocialProvider::Apple ? ! $hashed : (! $hashed && ! hash_equals($rawNonce, $claim))) {
            throw $this->fail($provider, 'nonce');
        }
    }

    /**
     * @return list<string>
     */
    private function issuers(SocialProvider $provider): array
    {
        if ($provider === SocialProvider::Apple) {
            return [config()->string('services.apple.issuer')];
        }

        /** @var list<string> $issuers */
        $issuers = config()->array('services.google.issuers');

        return $issuers;
    }

    /**
     * @return array<string, mixed>
     */
    private function header(string $jwt): array
    {
        $parts = explode('.', $jwt);

        if (count($parts) !== 3) {
            return [];
        }

        try {
            $header = JWT::jsonDecode(JWT::urlsafeB64Decode($parts[0]));
        } catch (Throwable) {
            return [];
        }

        return is_object($header) ? (array) $header : [];
    }

    /**
     * The RS256 keys of the provider's JWKS, fetched again (once per token) when $kid is not among the cached ones.
     *
     * @return array<string, Key>
     */
    private function keys(SocialProvider $provider, string $kid): array
    {
        $keys = $this->keySet($provider, refresh: false);

        if (! isset($keys[$kid])) {
            $keys = $this->keySet($provider, refresh: true);
        }

        if (! isset($keys[$kid])) {
            throw $this->fail($provider, 'unknown_kid');
        }

        return $keys;
    }

    /**
     * @return array<string, Key>
     */
    private function keySet(SocialProvider $provider, bool $refresh): array
    {
        $cacheKey = 'id-token-jwks:'.$provider->value;
        $lastGood = $cacheKey.':last-good';
        $failed = $cacheKey.':failed';

        $cached = Cache::get($cacheKey);

        if (! $refresh && is_array($cached)) {
            return $this->parse($provider, $cached);
        }

        // At most one refetch a minute per provider: unknown kids cannot turn this into a request amplifier.
        if ($refresh && ! Cache::add($cacheKey.':refetch', true, 60)) {
            return $this->parse($provider, $cached ?? Cache::get($lastGood));
        }

        // A fetch failed less than a minute ago: the last good keys, or the same 503 without asking the provider again.
        if (Cache::has($failed)) {
            return $this->lastGood($provider, $lastGood);
        }

        try {
            $jwks = $this->fetch($provider);
        } catch (ApiException $unavailable) {
            Cache::put($failed, true, config()->integer('speedclub.id_tokens.jwks_failure_cache_seconds'));

            return $this->lastGood($provider, $lastGood, $unavailable);
        }

        Cache::put($cacheKey, $jwks, now()->addHours(config()->integer('speedclub.id_tokens.jwks_cache_hours')));
        Cache::put($lastGood, $jwks, now()->addDays(config()->integer('speedclub.id_tokens.jwks_last_good_days')));

        return $this->parse($provider, $jwks);
    }

    /**
     * @return array<string, Key>
     */
    private function lastGood(SocialProvider $provider, string $key, ?ApiException $unavailable = null): array
    {
        $jwks = Cache::get($key);

        if (! is_array($jwks)) {
            throw $unavailable ?? new ApiException(ErrorCode::ServiceUnavailable);
        }

        return $this->parse($provider, $jwks);
    }

    /**
     * @return array<string, mixed>
     */
    private function fetch(SocialProvider $provider): array
    {
        try {
            $response = Http::timeout(config()->integer('speedclub.id_tokens.http_timeout_seconds'))
                ->acceptJson()
                ->get(config()->string('services.'.$provider->value.'.jwks_url'));
        } catch (Throwable $exception) {
            Log::warning('JWKS fetch failed.', ['provider' => $provider->value, 'type' => $exception::class]);

            throw new ApiException(ErrorCode::ServiceUnavailable);
        }

        $json = $response->json();

        if (! $response->successful() || ! is_array($json) || ! isset($json['keys']) || ! is_array($json['keys'])) {
            Log::warning('JWKS fetch failed.', ['provider' => $provider->value, 'status' => $response->status()]);

            throw new ApiException(ErrorCode::ServiceUnavailable);
        }

        /** @var array<string, mixed> $json */
        return $json;
    }

    /**
     * Only RSA signing keys for RS256 survive: a key with another alg or use is dropped before JWT::decode sees it.
     *
     * @return array<string, Key>
     */
    private function parse(SocialProvider $provider, mixed $jwks): array
    {
        if (! is_array($jwks) || ! isset($jwks['keys']) || ! is_array($jwks['keys'])) {
            return [];
        }

        $usable = array_values(array_filter($jwks['keys'], fn (mixed $key): bool => is_array($key)
            && ($key['kty'] ?? null) === 'RSA'
            && in_array($key['alg'] ?? 'RS256', ['RS256'], true)
            && in_array($key['use'] ?? 'sig', ['sig'], true)
            && isset($key['kid'])));

        if ($usable === []) {
            return [];
        }

        try {
            return JWK::parseKeySet(['keys' => $usable], 'RS256');
        } catch (Throwable $exception) {
            Log::warning('JWKS could not be parsed.', ['provider' => $provider->value, 'type' => $exception::class]);

            return [];
        }
    }

    private function fail(SocialProvider $provider, string $check): ApiException
    {
        Log::info('An ID token was refused.', ['provider' => $provider->value, 'check' => $check]);

        return new ApiException(ErrorCode::InvalidIdentityToken);
    }
}
