<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

use App\Enums\CatalogImportKind;
use App\Services\Catalog\CatalogCsv;
use Illuminate\Validation\Rule;

/**
 * ADM-17 upload (`catalog.import`): the CSV (at most 2 MB; AnalyseCatalogImport reads encoding, delimiter, header and rows) and what it
 * holds. The dry run changes nothing in the catalogue, so no reason.
 */
class ImportUploadRequest extends CatalogFormRequest
{
    protected function atom(): string
    {
        return 'catalog.import';
    }

    protected function reasonRequired(): bool
    {
        return false;
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'kind' => ['required', Rule::enum(CatalogImportKind::class)],
            'file' => ['required', 'file', 'max:'.(CatalogCsv::MAX_BYTES / 1024), 'mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel,text/x-csv'],
        ];
    }

    public function kind(): CatalogImportKind
    {
        return CatalogImportKind::from($this->string('kind')->value());
    }
}
