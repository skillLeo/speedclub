<?php

namespace App\Support;

/**
 * Username rules (02_PRODUCT_SPEC §3.1). Uniqueness is the unique index plus the caller's validation.
 */
final class Username
{
    public const VIOLATION_LENGTH = 'length';

    public const VIOLATION_CHARACTERS = 'characters';

    public const VIOLATION_START = 'start';

    public const VIOLATION_TRAILING_DOT = 'trailing_dot';

    public const VIOLATION_CONSECUTIVE_DOTS = 'consecutive_dots';

    public const VIOLATION_RESERVED = 'reserved';

    /**
     * Usernames are case-insensitive and stored lowercased.
     */
    public static function normalize(string $username): string
    {
        return mb_strtolower(trim($username));
    }

    /**
     * All broken rules of the normalised username, so a client can show each of them.
     *
     * @return list<string>
     */
    public static function violations(string $username): array
    {
        $username = self::normalize($username);
        $length = mb_strlen($username);
        $violations = [];

        if ($length < config()->integer('speedclub.usernames.min_length') || $length > config()->integer('speedclub.usernames.max_length')) {
            $violations[] = self::VIOLATION_LENGTH;
        }

        if (preg_match('/\A[a-z0-9._]*\z/', $username) !== 1) {
            $violations[] = self::VIOLATION_CHARACTERS;
        }

        if ($username !== '' && preg_match('/\A[a-z0-9]/', $username) !== 1) {
            $violations[] = self::VIOLATION_START;
        }

        if (str_ends_with($username, '.')) {
            $violations[] = self::VIOLATION_TRAILING_DOT;
        }

        if (str_contains($username, '..')) {
            $violations[] = self::VIOLATION_CONSECUTIVE_DOTS;
        }

        if (self::isReserved($username)) {
            $violations[] = self::VIOLATION_RESERVED;
        }

        return $violations;
    }

    public static function isValid(string $username): bool
    {
        return self::violations($username) === [];
    }

    /**
     * Also refuses what only looks like a reserved name, so nobody can pose as adm1n, supp0rt or speed.club. Both sides
     * are reduced to a skeleton, which keeps the list short and catches any mix of 1, l and i.
     */
    public static function isReserved(string $username): bool
    {
        /** @var list<string> $reserved */
        $reserved = config()->array('speedclub.usernames.reserved');

        return in_array(self::skeleton($username), array_map(self::skeleton(...), $reserved), true);
    }

    /**
     * Separators go. What reads alike becomes one letter: 0 and o, 3 and e, 5 and s, and 1, l and i.
     */
    private static function skeleton(string $username): string
    {
        return strtr(str_replace(['.', '_'], '', self::normalize($username)), ['0' => 'o', '1' => 'i', 'l' => 'i', '3' => 'e', '5' => 's']);
    }
}
