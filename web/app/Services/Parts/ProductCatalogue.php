<?php

namespace App\Services\Parts;

use App\Enums\ProductStatus;
use App\Models\Brand;
use App\Models\ModCategory;
use App\Models\Product;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogSlugs;
use App\Support\Slug;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * Imports the parts catalogue (09 §8.9, M4.14) from database/data/products.json (or a CSV with the columns marke/brand, produkt/name,
 * linie/line, kategorie/category, url) into products, and the brand facts of the file into brands. Used by `catalog:import-products`
 * and ProductSeeder; the admin's CSV import (ADM-17 kind products) plans through CatalogImportPlanner instead, with its dry-run diff.
 *
 * A product is found by brand and slug of its name (a merged brand speaks of its survivor) and never renamed; a re-run changes line,
 * category, attributes and url of what the file names and leaves archived or merged products as they are. Brand facts fill only what
 * is empty, so an edit in the admin stays. Rows naming an unknown brand or category are reported, never guessed.
 */
final class ProductCatalogue
{
    public const DATA_FILE = 'data/products.json';

    /**
     * @return array{created: int, updated: int, unchanged: int, brands: int, errors: list<string>}
     */
    public function importFile(string $path, bool $dryRun = false): array
    {
        if (! is_file($path)) {
            throw new InvalidArgumentException("No such file: $path");
        }

        $contents = (string) file_get_contents($path);

        if (str_ends_with(strtolower($path), '.csv')) {
            return $this->import(['brands' => [], 'products' => $this->csvRows($contents)], $dryRun);
        }

        $data = json_decode($contents, true);

        if (! is_array($data)) {
            throw new InvalidArgumentException('The file is not valid JSON.');
        }

        return $this->import($data, $dryRun);
    }

    /**
     * @param  array<string, mixed>  $data  {brands: {name: {about, website, country}}, products: list<{brand, category, name, line?, attributes?, url?}>}
     * @return array{created: int, updated: int, unchanged: int, brands: int, errors: list<string>}
     */
    public function import(array $data, bool $dryRun = false): array
    {
        $result = ['created' => 0, 'updated' => 0, 'unchanged' => 0, 'brands' => 0, 'errors' => []];
        $categories = ModCategory::query()->pluck('id', 'key')->all();

        $run = function () use ($data, $categories, &$result): void {
            foreach (is_array($data['brands'] ?? null) ? $data['brands'] : [] as $name => $facts) {
                $brand = is_string($name) ? CatalogSlugs::brand(Slug::make($name)) : null;

                if (! $brand instanceof Brand || ! is_array($facts)) {
                    $result['errors'][] = 'brand '.(is_string($name) ? $name : '?').': not in the catalogue';

                    continue;
                }

                $fill = array_filter([
                    'about' => $brand->about === null && is_array($facts['about'] ?? null) ? $facts['about'] : null,
                    'website' => $brand->website === null && is_string($facts['website'] ?? null) ? $facts['website'] : null,
                    'country' => $brand->country === null && is_string($facts['country'] ?? null) ? $facts['country'] : null,
                ], fn (mixed $value): bool => $value !== null);

                if ($fill !== []) {
                    $brand->forceFill($fill)->save();
                    $result['brands']++;
                }
            }

            foreach (is_array($data['products'] ?? null) ? $data['products'] : [] as $index => $row) {
                $this->product(is_array($row) ? $row : [], (int) $index, $categories, $result);
            }
        };

        if ($dryRun) {
            DB::beginTransaction();

            try {
                $run();
            } finally {
                DB::rollBack();
            }
        } else {
            DB::transaction($run);
        }

        return $result;
    }

    /**
     * @param  array<array-key, mixed>  $row
     * @param  array<string, int>  $categories
     * @param  array{created: int, updated: int, unchanged: int, brands: int, errors: list<string>}  $result
     */
    private function product(array $row, int $index, array $categories, array &$result): void
    {
        $name = is_string($row['name'] ?? null) ? trim($row['name']) : '';
        $brandName = is_string($row['brand'] ?? null) ? trim($row['brand']) : '';
        $category = is_string($row['category'] ?? null) ? $row['category'] : '';
        $label = "row $index ($brandName $name)";

        if ($name === '' || $brandName === '' || mb_strlen($name) > 160) {
            $result['errors'][] = "$label: brand and name are required (name at most 160 characters)";

            return;
        }

        $brand = CatalogSlugs::brand(Slug::make($brandName));

        if (! $brand instanceof Brand) {
            $result['errors'][] = "$label: unknown brand";

            return;
        }

        if (! isset($categories[$category])) {
            $result['errors'][] = "$label: unknown category";

            return;
        }

        $slug = Slug::make($name);
        $attributes = self::attributes($row['attributes'] ?? null);
        $values = [
            'category_id' => $categories[$category],
            'line' => is_string($row['line'] ?? null) && $row['line'] !== '' ? mb_substr($row['line'], 0, 120) : null,
            'attributes' => $attributes,
            'url' => is_string($row['url'] ?? null) && preg_match('~\Ahttps://~', $row['url']) === 1 ? mb_substr($row['url'], 0, 500) : null,
        ];

        $product = Product::query()->where('brand_id', $brand->id)->where('slug', $slug)->first();

        if ($product === null) {
            $product = new Product;
            $product->forceFill([...$values, 'brand_id' => $brand->id, 'name' => $name, 'slug' => $slug, 'status' => ProductStatus::Active])->save();
            $result['created']++;

            return;
        }

        $product->forceFill($values);

        if ($product->isDirty()) {
            $product->save();
            $result['updated']++;

            return;
        }

        $result['unchanged']++;
    }

    /**
     * {de: {label: value}, en: {…}} (or already as pairs) → {de: [[label, value], …], en: …}: pairs keep the order, which a JSON object
     * column does not (MySQL sorts object keys). Strings only, at most 12 rows per language.
     *
     * @return array<string, list<array{0: string, 1: string}>>|null
     */
    public static function attributes(mixed $value): ?array
    {
        if (! is_array($value)) {
            return null;
        }

        $clean = [];

        foreach (['de', 'en'] as $locale) {
            $rows = is_array($value[$locale] ?? null) ? $value[$locale] : [];
            $pairs = [];

            foreach ($rows as $key => $cell) {
                [$label, $text] = is_array($cell) && array_is_list($cell) && count($cell) === 2 ? [$cell[0], $cell[1]] : [$key, $cell];

                if (is_string($label) && is_string($text) && $label !== '' && $text !== '' && mb_strlen($label) <= 60 && mb_strlen($text) <= 120 && count($pairs) < 12) {
                    $pairs[] = [$label, $text];
                }
            }

            if ($pairs !== []) {
                $clean[$locale] = $pairs;
            }
        }

        return $clean === [] ? null : $clean;
    }

    /**
     * @return list<array<string, string>>
     */
    private function csvRows(string $contents): array
    {
        $parsed = CatalogCsv::parse($contents);
        $names = ['marke' => 'brand', 'brand' => 'brand', 'produkt' => 'name', 'name' => 'name', 'linie' => 'line', 'line' => 'line', 'kategorie' => 'category', 'category' => 'category', 'url' => 'url'];
        $columns = array_map(fn (string $cell): ?string => $names[CatalogCsv::headerKey($cell)] ?? null, $parsed['header']);
        $rows = [];

        foreach ($parsed['rows'] as $row) {
            $values = [];

            foreach ($columns as $position => $column) {
                if ($column !== null) {
                    $values[$column] = $row['cells'][$position] ?? '';
                }
            }

            $rows[] = $values;
        }

        return $rows;
    }
}
