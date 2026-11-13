<?php

namespace App\Services\Auth\IdTokens;

use App\Models\SocialAccount;
use Firebase\JWT\JWT;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Sign in with Apple's server calls (09 §8.1), only with the .p8 key (owner action OA-15): exchange the authorization code for a refresh
 * token at the first sign-in, and revoke it when the account is deleted. Without the key both are skipped and logged. Apple answers 200
 * to a revoke even for an unknown token, so a 200 is logged as "accepted", not as proof.
 */
final class AppleTokens
{
    public function configured(): bool
    {
        $path = config('services.apple.private_key_path');

        return is_string(config('services.apple.team_id')) && config('services.apple.team_id') !== ''
            && is_string(config('services.apple.key_id')) && config('services.apple.key_id') !== ''
            && is_string($path) && $path !== '' && is_readable($path);
    }

    /**
     * The refresh token for this authorization code, or null (no key, no code, or Apple refused).
     */
    public function exchange(?string $authorizationCode, ?string $clientId): ?string
    {
        if ($authorizationCode === null || $authorizationCode === '' || $clientId === null) {
            return null;
        }

        if (! $this->configured()) {
            Log::info('Apple code exchange skipped: no .p8 key configured.');

            return null;
        }

        try {
            $response = Http::asForm()->timeout(config()->integer('speedclub.id_tokens.http_timeout_seconds'))->post(config()->string('services.apple.token_url'), [
                'client_id' => $clientId,
                'client_secret' => $this->clientSecret($clientId),
                'code' => $authorizationCode,
                'grant_type' => 'authorization_code',
            ]);
        } catch (Throwable $exception) {
            Log::warning('Apple code exchange failed.', ['type' => $exception::class]);

            return null;
        }

        $token = $response->json('refresh_token');

        if (! $response->successful() || ! is_string($token)) {
            Log::warning('Apple code exchange refused.', ['status' => $response->status()]);

            return null;
        }

        return $token;
    }

    /**
     * Returns the outcome for the audit log: skipped, accepted (HTTP 200) or failed.
     */
    public function revoke(SocialAccount $account): string
    {
        $token = $account->getAttribute('refresh_token_encrypted');

        if (! is_string($token) || $token === '' || ! $this->configured()) {
            Log::info('Apple revoke skipped.', ['reason' => is_string($token) && $token !== '' ? 'no_key' : 'no_refresh_token']);

            return 'skipped';
        }

        /** @var list<string> $clients */
        $clients = config()->array('services.apple.client_ids');
        $clientId = $clients[0] ?? '';

        try {
            $response = Http::asForm()->timeout(config()->integer('speedclub.id_tokens.http_timeout_seconds'))->post(config()->string('services.apple.revoke_url'), [
                'client_id' => $clientId,
                'client_secret' => $this->clientSecret($clientId),
                'token' => $token,
                'token_type_hint' => 'refresh_token',
            ]);
        } catch (Throwable $exception) {
            Log::warning('Apple revoke failed.', ['type' => $exception::class]);

            return 'failed';
        }

        Log::info('Apple revoke answered.', ['status' => $response->status()]);

        return $response->successful() ? 'accepted' : 'failed';
    }

    /**
     * The ES256 client secret Apple asks for: 5 minutes, signed with the .p8 key.
     */
    private function clientSecret(string $clientId): string
    {
        $now = time();

        return JWT::encode([
            'iss' => config()->string('services.apple.team_id'),
            'iat' => $now,
            'exp' => $now + 300,
            'aud' => config()->string('services.apple.issuer'),
            'sub' => $clientId,
        ], (string) file_get_contents(config()->string('services.apple.private_key_path')), 'ES256', config()->string('services.apple.key_id'));
    }
}
