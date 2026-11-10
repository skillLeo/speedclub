<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Actions\Admin\Catalog\AnalyseCatalogImport;
use App\Actions\Admin\Catalog\ApplyCatalogImport;
use App\Actions\Admin\Catalog\RecordCatalogExport;
use App\Enums\ApprovalStatus;
use App\Enums\CatalogImportKind;
use App\Enums\CatalogImportStatus;
use App\Http\Controllers\Admin\Catalog\Requests\ImportApplyRequest;
use App\Http\Controllers\Admin\Catalog\Requests\ImportUploadRequest;
use App\Http\Controllers\Admin\Catalog\Support\Refusals;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\CatalogImport;
use App\Models\Staff;
use App\Services\Catalog\CatalogCsv;
use App\Services\Catalog\CatalogCsvWriter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-17 CSV import (m3.3-contract §2, catalog.import): upload → dry run (AnalyseCatalogImport: the diff per row new / changed /
 * unchanged / error with its row code, nothing changes) → "Übernehmen" (⚿, reason, catalog.manage as well; ApplyCatalogImport queues
 * the same Actions as manual edits, more than 100 changed rows only create the approval) → progress and the result per row. Templates
 * are the import's own format with one example row. History: the last 20 imports, newest first.
 */
class ImportController extends Controller
{
    private const HISTORY = 20;

    public function index(Request $request): Response
    {
        return $this->page($request, null);
    }

    public function show(Request $request, string $import): Response
    {
        $row = CatalogImport::query()->with(['creator:id,name', 'applier:id,name'])->find($import);
        abort_if($row === null, 404);

        return $this->page($request, $row);
    }

    public function store(ImportUploadRequest $request, AnalyseCatalogImport $analyse): RedirectResponse
    {
        $file = $request->file('file');
        abort_if(is_array($file) || $file === null, 422);
        $import = $analyse->handle($request->staff(), $request->kind(), (string) $file->get(), $file->getClientOriginalName());

        return redirect()->route('admin.catalog.import.show', ['import' => $import->id], 303)->with('success', 'catalog.flash.import_analysed');
    }

    public function apply(ImportApplyRequest $request, string $import, ApplyCatalogImport $apply): RedirectResponse
    {
        $row = CatalogImport::query()->find($import);
        abort_if($row === null, 404);

        return Refusals::answer(function () use ($request, $row, $apply): RedirectResponse {
            $outcome = $apply->handle($request->staff(), $row, (string) $request->reason());

            return $outcome instanceof ApprovalRequest
                ? back(303)->with('approval', ApprovalsGateway::flash($outcome))
                : back(303)->with('success', 'catalog.flash.import_queued');
        });
    }

    public function template(Request $request, string $kind, RecordCatalogExport $record): HttpResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $kind = CatalogImportKind::tryFrom($kind) ?? abort(404);
        $record->handle($staff, $kind, template: true);

        return response(CatalogCsvWriter::template($kind), 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="speedclub-vorlage-'.($kind === CatalogImportKind::Vehicles ? 'fahrzeuge' : 'teilemarken').'.csv"',
            'Cache-Control' => 'no-store',
        ]);
    }

    private function page(Request $request, ?CatalogImport $current): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Catalog/Import', [
            'history' => fn (): array => array_values(CatalogImport::query()->with(['creator:id,name', 'applier:id,name'])
                ->orderByDesc('created_at')->orderByDesc('id')->limit(self::HISTORY)->get()
                ->map(fn (CatalogImport $import): array => self::summary($import))->all()),
            'current' => fn (): ?array => $current === null ? null : [
                ...self::summary($current->refresh()->load(['creator:id,name', 'applier:id,name'])),
                ...self::detail($current, $staff),
            ],
            'limits' => ['rows' => CatalogCsv::MAX_ROWS, 'megabytes' => CatalogCsv::MAX_BYTES / 1024 / 1024, 'four_eyes_above' => 100],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function summary(CatalogImport $import): array
    {
        return [
            'id' => $import->id,
            'kind' => $import->kind->value,
            'status' => $import->status->value,
            'file' => $import->original_name,
            'rows' => $import->row_count,
            'counts' => ['new' => 0, 'changed' => 0, 'unchanged' => 0, 'error' => 0, ...($import->counts ?? [])],
            'progress' => $import->progress,
            'created_by' => $import->getRelationValue('creator')?->getAttribute('name'),
            'applied_by' => $import->getRelationValue('applier')?->getAttribute('name'),
            'created_at' => $import->created_at?->toIso8601String(),
            'finished_at' => $import->finished_at?->toIso8601String(),
            'expires_at' => $import->expires_at?->toIso8601String(),
        ];
    }

    /**
     * The dry run per row (without its internal plan data) with the apply's result per row, and whether this staff member may apply.
     *
     * @return array<string, mixed>
     */
    private static function detail(CatalogImport $import, Staff $staff): array
    {
        $results = [];

        foreach ($import->results ?? [] as $result) {
            if (isset($result['line'])) {
                $results[(int) $result['line']] = ['status' => $result['status'] ?? null, 'error' => $result['error'] ?? null];
            }
        }

        $approval = $import->approval_id === null ? null : ApprovalRequest::query()->find($import->approval_id);
        $waiting = $approval !== null && $approval->status === ApprovalStatus::Pending;
        $expired = $import->expires_at !== null && $import->expires_at->isPast();
        $open = $import->status === CatalogImportStatus::Analysed || ($import->status === CatalogImportStatus::AwaitingApproval && ! $waiting);

        return [
            'lines' => array_map(fn (array $row): array => [
                'line' => (int) ($row['line'] ?? 0),
                'status' => (string) ($row['status'] ?? 'error'),
                'level' => $row['level'] ?? null,
                'label' => (string) ($row['label'] ?? ''),
                'changes' => is_array($row['changes'] ?? null) ? $row['changes'] : [],
                'creates' => is_array($row['creates'] ?? null) ? array_values($row['creates']) : [],
                'error' => $row['error'] ?? null,
                'result' => $results[(int) ($row['line'] ?? 0)] ?? null,
            ], $import->rows ?? []),
            'approval' => $approval === null ? null : ['id' => $approval->id, 'status' => $approval->status->value, 'expires_at' => $approval->expires_at->toIso8601String()],
            'can_apply' => $open && ! $expired && $staff->can('catalog.manage') && $staff->can('catalog.import'),
            'expired' => $expired,
            'reason' => $import->reason,
        ];
    }
}
