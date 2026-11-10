<?php

namespace App\Services\Home;

/**
 * The Für dich cursor: the StreamState as compact JSON, base64url, signed with the app key (HMAC-SHA256), so a client can neither forge
 * one nor push ids of its own into the queries. A cursor that does not verify, or holds anything but the expected shapes, is refused
 * with the same 422 as a forged cursor of the other lists.
 */
final class StreamCursor
{
    private const ID = '/\A[0-9a-hjkmnp-tv-z]{26}\z/';

    private const SCORE = '/\A-?\d{1,6}\.\d{6}\z/';

    private const AT = '/\A\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\z/';

    /** An owner as the stream knows it: ownerKey(), never the member's id. */
    private const OWNER = '/\A[0-9a-f]{16}\z/';

    /** At most this many ids in any list of the state. */
    private const MAX_IDS = 32;

    public static function encode(StreamState $state): string
    {
        $payload = json_encode([
            'p' => $state->position,
            'd' => $state->deferred,
            'o' => $state->lastOwner,
            'r' => $state->run,
            'u' => $state->updatePosition,
            's' => $state->sinceUpdate,
            'l' => $state->recent,
            'x' => $state->excludedVehicles,
            'y' => $state->excludedUpdates,
            'e' => $state->epoch,
        ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
        $body = self::base64($payload);

        return $body.'.'.self::base64(self::signature($body));
    }

    public static function decode(string $cursor): ?StreamState
    {
        $parts = explode('.', $cursor);

        if (count($parts) !== 2 || ! hash_equals(self::base64(self::signature($parts[0])), $parts[1])) {
            return null;
        }

        $json = base64_decode(strtr($parts[0], '-_', '+/'), true);
        $data = is_string($json) ? json_decode($json, true) : null;

        if (! is_array($data)) {
            return null;
        }

        $position = self::matches($data['p'] ?? null, [self::SCORE, self::AT, self::ID]);
        $updatePosition = self::matches($data['u'] ?? null, [self::AT, self::ID]);
        $lists = [];

        foreach (['d', 'l', 'x', 'y'] as $key) {
            $list = self::ids($data[$key] ?? null);

            if ($list === null) {
                return null;
            }

            $lists[$key] = $list;
        }

        $owner = $data['o'] ?? null;
        $run = $data['r'] ?? null;
        $since = $data['s'] ?? null;
        $epoch = $data['e'] ?? null;

        if ($position === false || $updatePosition === false || ! is_int($epoch) || $epoch < 0 || ! is_int($run) || ! is_int($since) || $run < 0 || $since < 0 || $run > 100 || $since > 100
            || ($owner !== null && (! is_string($owner) || preg_match(self::OWNER, $owner) !== 1))) {
            return null;
        }

        return new StreamState(
            $position === null ? null : [$position[0], $position[1], $position[2]],
            $lists['d'],
            $owner,
            $run,
            $updatePosition === null ? null : [$updatePosition[0], $updatePosition[1]],
            $since,
            $lists['l'],
            $lists['x'],
            $lists['y'],
            $epoch,
        );
    }

    /**
     * @param  list<string>  $patterns  one per element
     * @return array<int, string>|null|false null when absent, false when malformed
     */
    private static function matches(mixed $value, array $patterns): array|null|false
    {
        if ($value === null) {
            return null;
        }

        if (! is_array($value) || ! array_is_list($value) || count($value) !== count($patterns)) {
            return false;
        }

        $strings = [];

        foreach ($patterns as $index => $pattern) {
            $part = $value[$index] ?? null;

            if (! is_string($part) || preg_match($pattern, $part) !== 1) {
                return false;
            }

            $strings[$index] = $part;
        }

        return $strings;
    }

    /**
     * @return list<string>|null
     */
    private static function ids(mixed $value): ?array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > self::MAX_IDS) {
            return null;
        }

        foreach ($value as $id) {
            if (! is_string($id) || preg_match(self::ID, $id) !== 1) {
                return null;
            }
        }

        return $value;
    }

    /**
     * The stream compares owners only for equality, so it holds a keyed hash of the member's id: the cursor (readable base64) then names
     * no member, also not the owner a card hides under ADR-148 a.
     */
    public static function ownerKey(string $ownerId): string
    {
        return substr(hash_hmac('sha256', 'feed-owner|'.$ownerId, config()->string('app.key')), 0, 16);
    }

    private static function signature(string $body): string
    {
        return substr(hash_hmac('sha256', 'feed-cursor|'.$body, config()->string('app.key'), true), 0, 16);
    }

    private static function base64(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
