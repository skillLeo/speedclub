<?php

namespace Database\Seeders;

use App\Services\Parts\ProductCatalogue;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * The parts catalogue of M4.14 (09 §8.9) from database/data/products.json: real products of real brands, no invented figures.
 * DatabaseSeeder runs it only while products is empty (ADR-234), after BrandSeeder and ModCategorySeeder.
 */
class ProductSeeder extends Seeder
{
    public function run(ProductCatalogue $catalogue): void
    {
        $result = $catalogue->importFile(database_path(ProductCatalogue::DATA_FILE));

        if ($result['errors'] !== []) {
            throw new RuntimeException('products.json: '.implode('; ', $result['errors']));
        }
    }
}
