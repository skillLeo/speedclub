<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Catalog\ApplyCatalogImport;
use App\Models\ApprovalRequest;
use App\Models\CatalogImport;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ChecksPayloadAtoms;
use App\Services\Approvals\FourEyes;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * catalog.import_apply (ADM-17, m3.3 §1a, ADR-214/229): applying a CSV import that changes more than 100 rows. Payload {import_id}.
 * Requester and approver hold `catalog.import` and `catalog.manage` (the apply runs the manual edit's Actions). At approval the import
 * must still wait for this approval with its file unchanged and unexpired; executing queues RunCatalogImport (the rows are applied in
 * the queue, not in the approving request).
 */
final class ApplyCatalogImportInBulk implements ApprovalHandler, ChecksPayloadAtoms
{
    public function __construct(private readonly ApplyCatalogImport $apply) {}

    public function key(): string
    {
        return 'catalog.import_apply';
    }

    public function atom(): string
    {
        return 'catalog.import';
    }

    public function atomsFor(array $payload): array
    {
        return ['catalog.manage'];
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, ['import_id' => ['required', 'string', 'size:26']])->validate();
        $import = CatalogImport::query()->find((string) $payload['import_id']);

        if (! $import instanceof CatalogImport) {
            throw ValidationException::withMessages(['import_id' => ['There is no such import.']]);
        }

        try {
            ApplyCatalogImport::ensureApplicable($import, forApproval: true);
        } catch (CatalogRefused $refused) {
            throw ValidationException::withMessages(['import_id' => [$refused->getMessage()]]);
        }
    }

    public function describe(array $payload): array
    {
        $id = $payload['import_id'] ?? null;
        $import = is_string($id) ? CatalogImport::query()->find($id) : null;

        return [
            'title' => 'approvals.catalog_import_apply.title',
            'subject_label' => $import?->original_name,
            'lines' => [
                ['label' => 'approvals.catalog_import_apply.kind', 'after' => $import?->kind->value],
                ['label' => 'approvals.catalog_import_apply.new', 'after' => (string) ($import->counts['new'] ?? 0)],
                ['label' => 'approvals.catalog_import_apply.changed', 'after' => (string) ($import->counts['changed'] ?? 0)],
                ['label' => 'approvals.catalog_import_apply.errors', 'after' => (string) ($import->counts['error'] ?? 0)],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'catalog.import_apply');
        $import = CatalogImport::query()->findOrFail((string) $request->payload['import_id']);
        $requester = Staff::query()->findOrFail($request->requested_by);

        $queued = $this->apply->execute($requester, $approver, $import, $request->reason);

        return ['import_id' => $queued->id, 'status' => $queued->status->value, 'records' => $queued->changedRows()];
    }
}
