<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\RecordCatalogExport;
use App\Enums\CatalogImportKind;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Catalog\CatalogCsvWriter;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ADM-14 / ADM-16 "CSV" (catalog.view + lists.export on the route, ADR-232): the catalogue in the import's own format (CatalogCsvWriter,
 * German Excel: UTF-8 BOM, `;`, formula-safe cells), audited as `catalog.exported` before it streams.
 */
class CatalogExportController extends Controller
{
    public function __invoke(Request $request, string $kind, RecordCatalogExport $record): StreamedResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        abort_unless($staff->can('lists.export'), 403);
        $kind = CatalogImportKind::tryFrom($kind) ?? abort(404);
        $record->handle($staff, $kind);

        $name = sprintf('speedclub-katalog-%s-%s.csv', $kind === CatalogImportKind::Vehicles ? 'fahrzeuge' : 'teilemarken', now(config()->string('speedclub.display_timezone'))->format('Y-m-d'));

        return response()->streamDownload(function () use ($kind): void {
            $out = fopen('php://output', 'w');

            if ($out !== false) {
                CatalogCsvWriter::export($kind, $out);
                fclose($out);
            }
        }, $name, ['Content-Type' => 'text/csv; charset=UTF-8', 'Cache-Control' => 'no-store']);
    }
}
