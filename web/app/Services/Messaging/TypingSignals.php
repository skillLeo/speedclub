<?php

namespace App\Services\Messaging;

use Illuminate\Support\Facades\Cache;

/**
 * [SIG sig.msg_typing] typing_until per member and conversation, in the cache (database store on shared hosting): now + typing_seconds.
 */
final class TypingSignals
{
    public function mark(string $conversationId, string $userId): void
    {
        $seconds = config()->integer('speedclub.messaging.typing_seconds');
        Cache::put($this->key($conversationId, $userId), now()->addSeconds($seconds)->getTimestamp(), $seconds + 1);
    }

    public function isTyping(string $conversationId, string $userId): bool
    {
        $until = Cache::get($this->key($conversationId, $userId));

        return is_int($until) && $until > now()->getTimestamp();
    }

    public function clear(string $conversationId, string $userId): void
    {
        Cache::forget($this->key($conversationId, $userId));
    }

    private function key(string $conversationId, string $userId): string
    {
        return 'typing:'.$conversationId.':'.$userId;
    }
}
