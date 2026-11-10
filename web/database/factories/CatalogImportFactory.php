<?php

namespace Database\Factories;

use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use App\Models\CatalogImport;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CatalogImport>
 */
class CatalogImportFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'kind' => CatalogImportKind::Vehicles,
            'status' => CatalogImportStatus::Analysed,
            'original_name' => 'katalog.csv',
            'path' => 'catalog-imports/'.fake()->uuid().'.csv',
            'file_hash' => hash('sha256', fake()->uuid()),
            'row_count' => 0,
            'counts' => ['new' => 0, 'changed' => 0, 'unchanged' => 0, 'error' => 0],
            'rows' => [],
            'expires_at' => now()->addDays(30),
        ];
    }
}
