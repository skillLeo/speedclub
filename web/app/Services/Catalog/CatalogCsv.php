<?php

namespace App\Services\Catalog;

use Illuminate\Validation\ValidationException;
use Normalizer;

/**
 * Reads the CSVs of ADM-17 as German Excel writes them (m3.3 §1): UTF-8 with or without BOM (or Windows-1252, "CSV (Trennzeichen-
 * getrennt)"), `;` or `,` (or a tab) as the delimiter, found from the header line outside quotes, quoted fields with "" escapes and line
 * breaks inside, CRLF or LF. Cells are trimmed; a leading apostrophe that CsvCell put in front of `=`, `+`, `-` or `@` on export is
 * taken off again, so an export can be edited and imported. Empty lines are skipped. Errors about the whole file are a
 * ValidationException on `file`.
 */
final class CatalogCsv
{
    public const MAX_BYTES = 2 * 1024 * 1024;

    public const MAX_ROWS = 5000;

    /**
     * @return array{delimiter: string, header: list<string>, rows: list<array{line: int, cells: list<string>}>}
     *
     * @throws ValidationException
     */
    public static function parse(string $contents): array
    {
        if (strlen($contents) > self::MAX_BYTES) {
            self::fail('too_large');
        }

        if (str_starts_with($contents, "\xEF\xBB\xBF")) {
            $contents = substr($contents, 3);
        } elseif (! mb_check_encoding($contents, 'UTF-8')) {
            $contents = (string) mb_convert_encoding($contents, 'UTF-8', 'Windows-1252');
        }

        if (trim($contents) === '') {
            self::fail('empty');
        }

        $delimiter = self::delimiter($contents);
        $stream = fopen('php://temp', 'r+');

        if ($stream === false) {
            self::fail('unreadable');
        }

        fwrite($stream, $contents);
        rewind($stream);

        $header = null;
        $rows = [];
        $record = 0;

        while (($cells = fgetcsv($stream, null, $delimiter, '"', '')) !== false) {
            $record++;

            if ($cells === [null] || array_filter($cells, fn (?string $cell): bool => $cell !== null && trim($cell) !== '') === []) {
                continue;
            }

            $cells = array_map(fn (?string $cell): string => self::clean((string) $cell), $cells);

            if ($header === null) {
                $header = $cells;

                continue;
            }

            if (count($rows) >= self::MAX_ROWS) {
                fclose($stream);
                self::fail('too_many_rows');
            }

            $rows[] = ['line' => $record, 'cells' => $cells];
        }

        fclose($stream);

        if ($header === null) {
            self::fail('empty');
        }

        return ['delimiter' => $delimiter, 'header' => $header, 'rows' => $rows];
    }

    /**
     * Header names compared loosely: lowercase, umlauts folded, spaces and dashes as underscores ("Baujahr von" → baujahr_von).
     */
    public static function headerKey(string $name): string
    {
        $name = mb_strtolower(trim($name));
        $name = strtr($name, ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'ß' => 'ss']);

        return trim((string) preg_replace('/[^a-z0-9]+/', '_', $name), '_');
    }

    /**
     * The delimiter that splits the first line (outside quotes) most often: `;` from German Excel, `,` elsewhere, a tab from a copy.
     */
    private static function delimiter(string $contents): string
    {
        $counts = [';' => 0, ',' => 0, "\t" => 0];
        $quoted = false;
        $length = strlen($contents);

        for ($i = 0; $i < $length; $i++) {
            $char = $contents[$i];

            if ($char === '"') {
                $quoted = ! $quoted;
            } elseif (! $quoted && ($char === "\n" || $char === "\r")) {
                break;
            } elseif (! $quoted && isset($counts[$char])) {
                $counts[$char]++;
            }
        }

        arsort($counts);

        return (string) array_key_first($counts);
    }

    private static function clean(string $cell): string
    {
        $cell = trim(str_replace("\u{00A0}", ' ', $cell));

        if (class_exists(Normalizer::class)) {
            $cell = Normalizer::normalize($cell, Normalizer::FORM_C) ?: $cell;
        }

        return preg_match('/\A\'[=+\-@]/', $cell) === 1 ? substr($cell, 1) : $cell;
    }

    /**
     * @throws ValidationException
     */
    private static function fail(string $code): never
    {
        throw ValidationException::withMessages(['file' => [(string) __('catalog_import.file.'.$code, ['max_rows' => self::MAX_ROWS, 'max_mb' => self::MAX_BYTES / 1024 / 1024])]]);
    }
}
