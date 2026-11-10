<?php

namespace App\Support;

use Closure;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * 8-character Crockford base32 codes (no I, L, O, U) from a CSPRNG, used for qr_codes.code and
 * vehicles.public_id. 32^8 is about 1.1 trillion values, so a collision is rare but must not fail a request.
 */
final class Codes
{
    public const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public const LENGTH = 8;

    public const MAX_ATTEMPTS = 5;

    public static function generate(): string
    {
        $code = '';

        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, 31)];
        }

        return $code;
    }

    public static function isValid(string $code): bool
    {
        return preg_match('/\A[0-9A-HJKMNP-TV-Z]{8}\z/', $code) === 1;
    }

    /**
     * Canonical form of user input: separators dropped, uppercase, with the Crockford read-alikes O → 0 and I, L → 1.
     * Returns null when the input cannot be a code, also for bytes that are no valid UTF-8.
     */
    public static function normalize(string $input): ?string
    {
        // As SEPARATORS in mobile/src/features/qr/code.ts: Crockford ignores hyphens, spaces come from the printed "7H2K QXMB". \s
        // with /u is every Unicode space; JavaScript also counts the byte order mark as one.
        $joined = preg_replace('/[\s\x{FEFF}\-\x{2010}-\x{2015}\x{2212}]+/u', '', trim($input));

        if ($joined === null) {
            return null;
        }

        $code = strtr(strtoupper($joined), ['O' => '0', 'I' => '1', 'L' => '1']);

        return self::isValid($code) ? $code : null;
    }

    /**
     * Runs $create with a fresh code and retries on a unique index violation. This is the safe way to
     * insert: a check before the insert would still race with concurrent requests.
     *
     * @template TResult
     *
     * @param  Closure(string): TResult  $create
     * @return TResult
     */
    public static function createUnique(Closure $create)
    {
        for ($attempt = 1; $attempt < self::MAX_ATTEMPTS; $attempt++) {
            try {
                return $create(self::generate());
            } catch (UniqueConstraintViolationException) {
                continue;
            }
        }

        return $create(self::generate());
    }
}
