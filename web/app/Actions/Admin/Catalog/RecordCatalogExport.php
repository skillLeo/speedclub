<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogImportKind;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-14 / ADM-16 / ADM-17 "CSV" (`catalog.view` + `lists.export`, ADR-232; an empty import template needs `catalog.view` only, its
 * route asks for `catalog.import`): audits `catalog.exported` before the controller streams CatalogCsvWriter::export() (or a template).
 * The catalogue holds no personal data; the event still says who took a copy. Checked here as well as on the route (SF-1 of the M3.3
 * review), so no other caller can hand out the list file without the export atom.
 */
class RecordCatalogExport
{
    /**
     * @throws AuthorizationException
     */
    public function handle(Staff $staff, CatalogImportKind $kind, bool $template = false): void
    {
        StaffAtoms::ensure($staff, 'catalog.view', ...($template ? [] : ['lists.export']));

        DB::transaction(fn () => Audit::record(CatalogEvent::Exported->value, null, after: ['kind' => $kind->value, 'template' => $template], actor: $staff));
    }
}
