<?php

namespace Tests\Support;

/**
 * The parity tests' reader of a TypeScript glyph table (ADR-422 a, ADR-426): the one object literal of a source file whose entries
 * are all "character: number" and that holds W and the digits, whatever its name; and of its pair kerning table (ADR-425 as
 * amended), the one literal whose keys are all two characters. Keys are quoted strings (with \u escapes),
 * identifiers (Unicode letters too: ß) or digits. Nothing is evaluated.
 */
final class TypeScriptTable
{
    /**
     * @return array<string, float>|null
     */
    public static function glyphTable(string $source): ?array
    {
        $key = '\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*"|[\p{L}_$][\p{L}\p{N}_$]*|\d';
        // Braces inside a quoted key ('\u{202F}') do not end the literal.
        preg_match_all('/\{((?:[^{}\'"]|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")*)\}/su', $source, $literals);

        foreach ($literals[1] as $body) {
            $body = (string) preg_replace('~//[^\n]*|/\*.*?\*/~s', '', $body);
            preg_match_all('/('.$key.')\s*:\s*(\d*\.?\d+)\s*(?:,|$)/su', $body, $entries, PREG_SET_ORDER);

            // Only a literal made of nothing but such entries.
            if ($entries === [] || trim(str_replace(array_column($entries, 0), '', $body)) !== '') {
                continue;
            }

            $table = [];
            foreach ($entries as $entry) {
                $table[self::key($entry[1])] = (float) $entry[2];
            }

            if (isset($table['W'], $table['0'], $table['9']) && count($table) > 20) {
                return $table;
            }
        }

        return null;
    }

    /**
     * The one object literal of a source file whose entries are all "two-character string: number" (a pair kerning table,
     * ADR-425 as amended), whatever its name; null when the file has none, or more than one.
     *
     * @return array<string, float>|null
     */
    public static function pairTable(string $source): ?array
    {
        $key = '\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*"';
        preg_match_all('/\{((?:[^{}\'"]|\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")*)\}/su', $source, $literals);
        $found = [];

        foreach ($literals[1] as $body) {
            $body = (string) preg_replace('~//[^\n]*|/\*.*?\*/~s', '', $body);
            preg_match_all('/('.$key.')\s*:\s*(\d*\.?\d+)\s*(?:,|$)/su', $body, $entries, PREG_SET_ORDER);

            if ($entries === [] || trim(str_replace(array_column($entries, 0), '', $body)) !== '') {
                continue;
            }

            $table = [];
            foreach ($entries as $entry) {
                $table[self::key($entry[1])] = (float) $entry[2];
            }

            if (array_filter(array_keys($table), fn (int|string $pair): bool => mb_strlen((string) $pair) !== 2) === []) {
                $found[] = $table;
            }
        }

        return count($found) === 1 ? $found[0] : null;
    }

    public static function key(string $key): string
    {
        if (! in_array($key[0], ['\'', '"'], true)) {
            return $key;
        }

        return (string) preg_replace_callback('/\\\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|.)/u', function (array $m): string {
            $hex = ($m[2] ?? '') !== '' ? $m[2] : (($m[3] ?? '') !== '' ? $m[3] : ($m[4] ?? ''));

            return $hex !== '' ? mb_chr((int) hexdec($hex)) : $m[1];
        }, substr($key, 1, -1));
    }
}
