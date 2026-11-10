<?php

namespace App\Support;

use RuntimeException;

/**
 * The list of common passwords shipped in database/data (02_PRODUCT_SPEC §3.1). No external API: a password never leaves
 * the server. Without the list the check cannot answer, so it refuses instead of letting every password through.
 */
final class CommonPasswords
{
    public static function contains(string $password): bool
    {
        $handle = self::open();
        $needle = mb_strtolower($password);
        $found = false;

        while (! $found && ($line = fgets($handle)) !== false) {
            $found = rtrim($line, "\r\n") === $needle;
        }

        fclose($handle);

        return $found;
    }

    /**
     * How many entries can match at all: anything shorter than the minimum length fails on that rule first.
     */
    public static function reachableEntries(): int
    {
        $handle = self::open();
        $minimum = config()->integer('speedclub.passwords.min_length');
        $count = 0;

        while (($line = fgets($handle)) !== false) {
            if (mb_strlen(rtrim($line, "\r\n")) >= $minimum) {
                $count++;
            }
        }

        fclose($handle);

        return $count;
    }

    /**
     * @return resource
     */
    private static function open()
    {
        $path = config()->string('speedclub.passwords.common_list');
        $handle = is_file($path) && filesize($path) > 0 ? fopen($path, 'r') : false;

        if ($handle === false) {
            throw new RuntimeException('The list of common passwords is missing or empty.');
        }

        return $handle;
    }
}
