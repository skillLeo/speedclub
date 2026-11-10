<?php

namespace App\Services\Catalog;

use App\Actions\Admin\Catalog\CreateCatalogEntry;
use App\Actions\Admin\Catalog\SetCatalogEntryActive;
use App\Actions\Admin\Catalog\UpdateCatalogEntry;
use App\Enums\CatalogLevel;
use App\Enums\CatalogRowStatus;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;

/**
 * Applies one planned import row (CatalogImportPlanner::row against the catalogue now) through the Actions of a manual edit
 * (m3.3 §2: "apply runs the same Actions as manual edits"): CreateCatalogEntry, UpdateCatalogEntry, SetCatalogEntryActive, each with its
 * own transaction and audit event. Applying a row again finds it unchanged.
 *
 * @phpstan-import-type PlannedRow from CatalogImportPlanner
 */
final class CatalogImportApplier
{
    public function __construct(
        private readonly CreateCatalogEntry $create,
        private readonly UpdateCatalogEntry $update,
        private readonly SetCatalogEntryActive $active,
    ) {}

    /**
     * @param  PlannedRow  $row  planned now, without errors
     */
    public function apply(array $row, Staff $staff, string $reason): void
    {
        if ($row['status'] === CatalogRowStatus::Unchanged->value || $row['status'] === CatalogRowStatus::Error->value) {
            return;
        }

        $data = $row['data'];

        if ($row['level'] === 'brand') {
            $this->brand($data, $staff, $reason);

            return;
        }

        /** @var array{make: string, model: string, generation: string} $names */
        $names = $data['names'];
        /** @var array<string, string> $slugs */
        $slugs = $data['slugs'];
        $level = (string) $data['level'];
        /** @var bool|null $active */
        $active = $data['active'];

        $make = CatalogSlugs::make($slugs['make']);

        if ($make === null) {
            /** @var Make $make */
            $make = $this->create->handle($staff, CatalogLevel::Make, array_filter([
                'name' => $names['make'],
                'slug' => $slugs['make'],
                'country' => $data['country'],
                'is_popular' => $data['popular'],
                'active' => $level === 'make' ? $active : null,
            ], fn (mixed $value): bool => $value !== null), $reason);
        } else {
            $this->update->handle($staff, $make, array_filter(['country' => $data['country'], 'is_popular' => $data['popular']], fn (mixed $value): bool => $value !== null), $reason);

            if ($level === 'make' && $active !== null) {
                $this->active->handle($staff, $make, $active, $reason);
            }
        }

        if ($names['model'] === '') {
            return;
        }

        $model = CatalogSlugs::model($make, $slugs['model']);

        if ($model === null) {
            /** @var VehicleModel $model */
            $model = $this->create->handle($staff, CatalogLevel::Model, array_filter([
                'make_id' => $make->getKey(),
                'name' => $names['model'],
                'slug' => $slugs['model'],
                'active' => $level === 'model' ? $active : null,
            ], fn (mixed $value): bool => $value !== null), $reason);
        } elseif ($level === 'model' && $active !== null) {
            $this->active->handle($staff, $model, $active, $reason);
        }

        if ($names['generation'] === '') {
            return;
        }

        /** @var array<string, int> $years */
        $years = $data['years'];
        $generation = CatalogSlugs::generation($model, $slugs['generation']);

        if ($generation === null) {
            $this->create->handle($staff, CatalogLevel::Generation, array_filter([
                'model_id' => $model->getKey(),
                'name' => $names['generation'],
                'slug' => $slugs['generation'],
                'active' => $active,
                ...$years,
            ], fn (mixed $value): bool => $value !== null), $reason);

            return;
        }

        if ($years !== []) {
            $this->update->handle($staff, $generation, $years, $reason);
        }

        if ($active !== null) {
            /** @var Generation $generation */
            $this->active->handle($staff, $generation, $active, $reason);
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function brand(array $data, Staff $staff, string $reason): void
    {
        $brand = CatalogSlugs::brand((string) $data['slug']);
        $attributes = array_filter(['category_hint' => $data['category_hint'], 'aliases' => $data['aliases'] === [] ? null : $data['aliases']], fn (mixed $value): bool => $value !== null);

        if ($brand === null) {
            $this->create->handle($staff, CatalogLevel::Brand, ['name' => $data['name'], 'slug' => $data['slug'], ...$attributes], $reason);

            return;
        }

        /** @var Brand $brand */
        $this->update->handle($staff, $brand, $attributes, $reason);
    }
}
