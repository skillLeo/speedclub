<?php

namespace App\Services\Messaging;

use Illuminate\Support\Str;

/**
 * Message ids, strictly increasing per conversation. Called under the conversation's row lock with its last message id: a fresh ULID
 * when it sorts after that one, otherwise that id plus one. Two PHP processes in the same millisecond draw random ULID parts that need
 * not sort in commit order, and `messages?after=` would then skip the message that committed second (m2.4 handover §5).
 */
final class MessageIds
{
    private const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

    public static function after(?string $last): string
    {
        $candidate = strtolower((string) Str::ulid());

        if ($last === null || strcmp($candidate, $last) > 0) {
            return $candidate;
        }

        return self::increment(strtolower($last));
    }

    public static function increment(string $ulid): string
    {
        $chars = str_split($ulid);

        for ($i = count($chars) - 1; $i >= 0; $i--) {
            $position = strpos(self::ALPHABET, $chars[$i]);

            if ($position === false) {
                throw new \InvalidArgumentException('Not a ULID.');
            }

            if ($position < 31) {
                $chars[$i] = self::ALPHABET[$position + 1];

                return implode('', $chars);
            }

            $chars[$i] = '0';
        }

        throw new \OverflowException('ULID overflow.');
    }
}
