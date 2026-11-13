<?php

namespace App\Services\Auth\IdTokens;

use App\Enums\SocialProvider;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * SEC-M46-05: the nonce of an Apple or Google ID token comes from the server (POST auth/nonce), is bound to its provider, lives 10
 * minutes and is spent by the first token that carries it. A token captured elsewhere (another app with the same client ID, a replay)
 * cannot carry one of ours. Only a hash of the nonce is kept.
 */
final class IdTokenNonces
{
    public function issue(SocialProvider $provider): string
    {
        $nonce = Str::random(43);

        Cache::put($this->key($provider, $nonce), true, now()->addMinutes(config()->integer('speedclub.id_tokens.nonce_minutes')));

        return $nonce;
    }

    /**
     * True once per issued nonce; false for one we never issued, of the other provider, spent or expired.
     */
    public function consume(SocialProvider $provider, string $nonce): bool
    {
        return Cache::pull($this->key($provider, $nonce)) === true;
    }

    public function ttlSeconds(): int
    {
        return config()->integer('speedclub.id_tokens.nonce_minutes') * 60;
    }

    private function key(SocialProvider $provider, string $nonce): string
    {
        return 'id-token-nonce:'.$provider->value.':'.hash('sha256', $nonce);
    }
}
