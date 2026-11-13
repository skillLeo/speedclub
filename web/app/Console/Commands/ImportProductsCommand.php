<?php

namespace App\Console\Commands;

use App\Services\Parts\ProductCatalogue;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use InvalidArgumentException;

/**
 * M4.14 (09 §8.9): imports the parts catalogue from the data file of the repository (database/data/products.json) or another JSON or
 * CSV file. Safe to run again; --dry-run reports without writing.
 */
#[Signature('catalog:import-products {file? : JSON or CSV file, default database/data/products.json} {--dry-run : Report what would change without writing}')]
#[Description('Import part products and brand facts into the parts catalogue')]
class ImportProductsCommand extends Command
{
    public function handle(ProductCatalogue $catalogue): int
    {
        $file = $this->argument('file');
        $path = is_string($file) && $file !== '' ? $file : database_path(ProductCatalogue::DATA_FILE);

        try {
            $result = $catalogue->importFile($path, (bool) $this->option('dry-run'));
        } catch (InvalidArgumentException $error) {
            $this->error($error->getMessage());

            return self::FAILURE;
        }

        $this->info(sprintf('%sProducts: %d new, %d changed, %d unchanged; brands filled: %d; errors: %d',
            $this->option('dry-run') ? '[dry run] ' : '', $result['created'], $result['updated'], $result['unchanged'], $result['brands'], count($result['errors'])));

        foreach ($result['errors'] as $error) {
            $this->warn($error);
        }

        return $result['errors'] === [] ? self::SUCCESS : self::FAILURE;
    }
}
