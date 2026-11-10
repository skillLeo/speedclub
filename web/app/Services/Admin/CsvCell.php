<?php

namespace App\Services\Admin;

/**
 * Spreadsheet formula injection (OWASP CSV injection, SF-5 / SEC-P3-06): every CSV the admin writes passes its cells through here. A
 * cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so Excel and LibreOffice show it as
 * text instead of running it. JSONL keeps the raw values (it is read by programs, and the hash chain is checked against them).
 */
final class CsvCell
{
    public static function safe(mixed $value): string
    {
        $text = match (true) {
            $value === null => '',
            is_bool($value) => $value ? '1' : '0',
            is_scalar($value) => (string) $value,
            default => (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        };

        return preg_match('/\A[=+\-@\t\r]/', $text) === 1 ? "'".$text : $text;
    }

    /**
     * @param  array<array-key, mixed>  $values
     * @return list<string>
     */
    public static function row(array $values): array
    {
        return array_values(array_map(self::safe(...), $values));
    }
}
