<?php

namespace App\Services\Ai;

/**
 * "No invented numbers" (02 §6): the numbers of a text, normalised (decimal comma or point, thousands separators of 4+ digit groups),
 * so a generated text or a suggested field can be checked against the numbers of its input.
 */
final class Numbers
{
    /**
     * @return list<string> each number as a normalised decimal string ("8.5", "19", "1998")
     */
    public static function in(string $text): array
    {
        preg_match_all('/\d{1,3}(?:\.\d{3})+(?![\d,.])|\d+(?:[.,]\d+)?/u', $text, $matches);

        return array_values(array_unique(array_map(self::normalise(...), $matches[0])));
    }

    public static function normalise(string|int|float $number): string
    {
        if (is_int($number) || is_float($number)) {
            $value = (float) $number;
        } else {
            $plain = preg_match('/^\d{1,3}(?:\.\d{3})+$/u', $number) === 1 ? preg_replace('/\./u', '', $number) : str_replace(',', '.', $number);
            $value = (float) $plain;
        }

        return rtrim(rtrim(number_format($value, 3, '.', ''), '0'), '.');
    }

    /** Whether every number of $output also stands in $input. */
    public static function allFrom(string $output, string $input): bool
    {
        return array_diff(self::in($output), self::in($input)) === [];
    }

    public static function isFrom(int|float $number, string $input): bool
    {
        return in_array(self::normalise($number), self::in($input), true);
    }
}
