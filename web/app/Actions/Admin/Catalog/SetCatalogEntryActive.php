<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogMerger;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 "Deaktivieren" / "Aktivieren" (`catalog.manage`, reason): an inactive make, model or generation is hidden from the pickers
 * (catalog/* endpoints, search/interpret) and refused for new vehicles, and stays on every build that has it (m3.3 §1). A merged row
 * stays inactive. Audited as `catalog.deactivated` / `catalog.activated`. The catalogue endpoints carry content ETags and
 * search/interpret stamps the tables, so the app sees the change on its next request.
 */
class SetCatalogEntryActive
{
    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, Make|VehicleModel|Generation $entry, bool $active, string $reason): Make|VehicleModel|Generation
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($staff, $entry, $active, $reason): Make|VehicleModel|Generation {
            /** @var Make|VehicleModel|Generation $row */
            $row = $entry->newQuery()->whereKey($entry->getKey())->lockForUpdate()->firstOrFail();

            if ($row->getAttribute('merged_into_id') !== null) {
                throw new CatalogRefused('merged');
            }

            if ((bool) $row->getAttribute('active') === $active) {
                return $row;
            }

            $row->forceFill(['active' => $active])->save();

            Audit::record(($active ? CatalogEvent::Activated : CatalogEvent::Deactivated)->value, $row,
                before: ['level' => CatalogMerger::level($row)->value, 'active' => ! $active],
                after: ['level' => CatalogMerger::level($row)->value, 'active' => $active],
                reason: $reason, actor: $staff);

            return $row;
        });
    }
}
