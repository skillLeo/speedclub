<?php

namespace App\Services\Catalog;

use App\Enums\CatalogImportKind;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Admin\CsvCell;
use Generator;

/**
 * The CSVs ADM-17 hands out: the templates and the exports of the catalogue, in the import's own format (CatalogImportPlanner::COLUMNS,
 * German headers), as German Excel opens them: UTF-8 with BOM, `;`, CRLF, quoted where needed. Every cell passes CsvCell (formula
 * injection, SF-5): a name starting with `=`, `+`, `-` or `@` gets an apostrophe, which CatalogCsv takes off again on import.
 * Merged entries are left out (they are aliases, not entries).
 */
final class CatalogCsvWriter
{
    public const BOM = "\xEF\xBB\xBF";

    public const DELIMITER = ';';

    /**
     * @return list<string>
     */
    public static function header(CatalogImportKind $kind): array
    {
        return array_values(array_map(fn (array $names): string => self::label($names[0]), CatalogImportPlanner::COLUMNS[$kind->value]));
    }

    /**
     * The template: the header and one example row.
     */
    public static function template(CatalogImportKind $kind): string
    {
        $example = $kind === CatalogImportKind::Vehicles
            ? ['BMW', '', 'DE', 'ja', 'M4', '', 'G82', '', '2021', '', 'ja']
            : ['Akrapovič', '', 'exhaust', 'Akrapovic|Akra'];

        return self::BOM.self::line(self::header($kind)).self::line($example);
    }

    /**
     * Writes the export to $out (a stream), row by row, in bounded memory. Returns the number of data rows.
     *
     * @param  resource  $out
     */
    public static function export(CatalogImportKind $kind, $out): int
    {
        fwrite($out, self::BOM.self::line(self::header($kind)));
        $count = 0;

        foreach ($kind === CatalogImportKind::Vehicles ? self::vehicleRows() : self::brandRows() as $row) {
            fwrite($out, self::line($row));
            $count++;
        }

        return $count;
    }

    /**
     * @param  list<mixed>  $cells
     */
    public static function line(array $cells): string
    {
        $handle = fopen('php://temp', 'r+');

        if ($handle === false) {
            return '';
        }

        fputcsv($handle, CsvCell::row($cells), self::DELIMITER, '"', '', "\r\n");
        rewind($handle);
        $line = (string) stream_get_contents($handle);
        fclose($handle);

        return $line;
    }

    /**
     * One row per generation; a model without generations and a make without models get a row of their own.
     *
     * @return Generator<int, list<mixed>>
     */
    private static function vehicleRows(): Generator
    {
        foreach (Make::query()->whereNull('merged_into_id')->lazyById(200) as $make) {
            $base = [$make->getAttribute('name'), $make->getAttribute('slug'), $make->getAttribute('country'), self::yesNo((bool) $make->getAttribute('is_popular'))];
            $models = VehicleModel::query()->where('make_id', $make->getKey())->whereNull('merged_into_id')->orderBy('name')->orderBy('id')->get();

            if ($models->isEmpty()) {
                yield [...$base, '', '', '', '', '', '', self::yesNo((bool) $make->getAttribute('active'))];

                continue;
            }

            foreach ($models as $model) {
                $generations = Generation::query()->where('model_id', $model->getKey())->whereNull('merged_into_id')->orderBy('year_from')->orderBy('id')->get();

                if ($generations->isEmpty()) {
                    yield [...$base, $model->getAttribute('name'), $model->getAttribute('slug'), '', '', '', '', self::yesNo((bool) $model->getAttribute('active'))];

                    continue;
                }

                foreach ($generations as $generation) {
                    yield [
                        ...$base,
                        $model->getAttribute('name'),
                        $model->getAttribute('slug'),
                        $generation->getAttribute('name'),
                        $generation->getAttribute('slug'),
                        $generation->getAttribute('year_from'),
                        $generation->getAttribute('year_to'),
                        self::yesNo((bool) $generation->getAttribute('active')),
                    ];
                }
            }
        }
    }

    /**
     * @return Generator<int, list<mixed>>
     */
    private static function brandRows(): Generator
    {
        foreach (Brand::query()->whereNull('merged_into_id')->lazyById(500) as $brand) {
            yield [
                $brand->getAttribute('name'),
                $brand->getAttribute('slug'),
                $brand->getAttribute('category_hint'),
                implode('|', is_array($brand->aliases) ? array_filter($brand->aliases, is_string(...)) : []),
            ];
        }
    }

    private static function yesNo(bool $value): string
    {
        return $value ? 'ja' : 'nein';
    }

    /** "baujahr_von" → "Baujahr von". */
    private static function label(string $key): string
    {
        $text = str_replace('_', ' ', $key);

        return mb_strtoupper(mb_substr($text, 0, 1)).mb_substr($text, 1);
    }
}
