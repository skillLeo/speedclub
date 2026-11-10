<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Catalog\MergeCatalogEntries;
use App\Enums\CatalogLevel;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use App\Services\Catalog\CatalogMerger;
use App\Services\Catalog\CatalogReferences;
use App\Services\Catalog\CatalogRefused;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * catalog.bulk_merge (ADM-14 / ADM-16, m3.3 §1, ADR-214/229): a merge of makes, models, generations or brands that touches more than
 * 100 vehicles. Payload {level: make|model|generation|brand, source_id, target_id}. At approval the pair must still be mergeable (both
 * exist, neither merged since); the merge itself is quick, the relink and search rebuild follow in the queue, so it runs inside the
 * approving transaction.
 */
final class MergeCatalogEntriesInBulk implements ApprovalHandler
{
    public function __construct(private readonly MergeCatalogEntries $merge) {}

    public function key(): string
    {
        return 'catalog.bulk_merge';
    }

    public function atom(): string
    {
        return 'catalog.manage';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'level' => ['required', Rule::enum(CatalogLevel::class)],
            'source_id' => ['required', 'integer', 'min:1'],
            'target_id' => ['required', 'integer', 'min:1', 'different:source_id'],
        ])->validate();

        try {
            DB::transaction(fn () => CatalogMerger::lockPair(CatalogLevel::from((string) $payload['level']), (int) $payload['source_id'], (int) $payload['target_id']));
        } catch (CatalogRefused $refused) {
            throw ValidationException::withMessages(['source_id' => [$refused->getMessage()]]);
        }
    }

    public function describe(array $payload): array
    {
        $level = CatalogLevel::tryFrom((string) ($payload['level'] ?? '')) ?? CatalogLevel::Make;
        $class = CatalogMerger::modelClass($level);
        $source = $class::query()->find($payload['source_id'] ?? 0);
        $target = $class::query()->find($payload['target_id'] ?? 0);
        $label = fn ($row): ?string => $row === null ? null : $row->getAttribute('name').' ('.$row->getAttribute('slug').')';

        return [
            'title' => 'approvals.catalog_bulk_merge.title',
            'subject_label' => $label($source),
            'lines' => [
                ['label' => 'approvals.catalog_bulk_merge.level', 'after' => $level->value],
                ['label' => 'approvals.catalog_bulk_merge.merge', 'before' => $label($source), 'after' => $label($target)],
                ['label' => 'approvals.catalog_bulk_merge.vehicles', 'after' => (string) CatalogReferences::vehicles($level, (int) ($payload['source_id'] ?? 0))],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'catalog.bulk_merge');
        $payload = $request->payload;
        $requester = Staff::query()->findOrFail($request->requested_by);

        return $this->merge->execute(
            $requester,
            $approver,
            CatalogLevel::from((string) $payload['level']),
            (int) $payload['source_id'],
            (int) $payload['target_id'],
            $request->reason,
        );
    }
}
