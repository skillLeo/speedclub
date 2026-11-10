<?php

namespace App\Support;

use Illuminate\Support\Facades\Hash;

/**
 * The `hashed` cast keeps a value that already looks like a hash, so a chosen password of that shape would be stored as it
 * is, and the rules on it would mean nothing. Actions always call Hash::make; this refuses the input as well.
 */
final class PasswordShape
{
    /**
     * Hash::isHashed only knows the algorithms this PHP was built with, so the prefixes are checked too.
     */
    public static function looksHashed(string $value): bool
    {
        return Hash::isHashed($value) || preg_match('/\A\$(2[abxy]?|argon2(id|i|d))\$/', $value) === 1;
    }
}
