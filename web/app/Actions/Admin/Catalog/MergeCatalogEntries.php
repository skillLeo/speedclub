<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Enums\CatalogLevel;
use App\Models\Brand;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Staff;
use App\Models\VehicleModel;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogMerger;
use App\Services\Catalog\CatalogReferences;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-14 / ADM-16 "Zusammenführen" (`catalog.manage`, reason): the source becomes an alias of the survivor and every reference follows
 * (CatalogMerger, then RelinkCatalogVehicles / RelinkBrandModifications in the queue: vehicles, their slugs, modifications,
 * vehicle_search and its facets). Four-eyes (`catalog.bulk_merge`, ADR-214) when the merge touches more than 100 vehicles together with
 * the merges the same staff member ran without approval in the last 24 hours (ADR-229), or while another merge of theirs is running;
 * its handler calls execute() from Approvals::approve(), nowhere else (FourEyes).
 *
 * One `catalog.merged` event on the survivor: before {level, source, target} with their vehicle counts, after {survivor vehicles,
 * records (the affected vehicles), what moved, requested_by, approved_by}.
 */
class MergeCatalogEntries
{
    public function __construct(
        private readonly Approvals $approvals,
        private readonly CatalogMerger $merger,
    ) {}

    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, CatalogLevel $level, int $sourceId, int $targetId, string $reason): MergeOutcome
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::required($reason);

        // Refused before anything is asked: a pair that cannot merge needs no second pair of eyes.
        DB::transaction(fn () => CatalogMerger::lockPair($level, $sourceId, $targetId));

        $affected = CatalogReferences::vehicles($level, $sourceId);
        $ask = function () use ($staff, $level, $sourceId, $targetId, $reason): MergeOutcome {
            $source = CatalogMerger::modelClass($level)::query()->findOrFail($sourceId);

            return new MergeOutcome(approval: $this->approvals->request('catalog.bulk_merge', [
                'level' => $level->value,
                'source_id' => $sourceId,
                'target_id' => $targetId,
            ], $reason, $staff, $source));
        };

        return BulkRunner::alone($staff, 'catalog.merge', $ask, function () use ($staff, $level, $sourceId, $targetId, $reason, $affected, $ask): MergeOutcome {
            if ($affected + BulkRunner::recentDirect($staff, CatalogEvent::Merged->value) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return new MergeOutcome($this->run($staff, null, $level, $sourceId, $targetId, $reason));
        });
    }

    /**
     * The approved merge: only from the `catalog.bulk_merge` handler while Approvals::approve() executes that request (FourEyes), for
     * exactly the pair it names.
     *
     * @return array<string, mixed>
     *
     * @throws AuthorizationException|CatalogRefused
     */
    public function execute(Staff $requester, Staff $approver, CatalogLevel $level, int $sourceId, int $targetId, string $reason): array
    {
        $request = FourEyes::executor(['catalog.bulk_merge'], $requester, $approver, 'catalog.manage');
        $payload = $request->payload;

        if (($payload['level'] ?? null) !== $level->value || (int) ($payload['source_id'] ?? 0) !== $sourceId || (int) ($payload['target_id'] ?? 0) !== $targetId) {
            throw new AuthorizationException('The approval names another merge.');
        }

        return $this->run($requester, $approver, $level, $sourceId, $targetId, $reason);
    }

    /**
     * @return array<string, mixed>
     */
    private function run(Staff $requester, ?Staff $approver, CatalogLevel $level, int $sourceId, int $targetId, string $reason): array
    {
        return DB::transaction(function () use ($requester, $approver, $level, $sourceId, $targetId, $reason): array {
            [$source, $target] = CatalogMerger::lockPair($level, $sourceId, $targetId);
            $sourceVehicles = CatalogReferences::vehicles($level, $sourceId);
            $targetVehicles = CatalogReferences::vehicles($level, $targetId);

            $moved = $this->merger->merge($source, $target);

            $summary = [
                'level' => $level->value,
                'survivor_id' => $targetId,
                'merged_id' => $sourceId,
                'vehicles' => $sourceVehicles + $targetVehicles,
                'records' => $sourceVehicles,
                ...$moved,
            ];

            Audit::record(CatalogEvent::Merged->value, $target,
                before: [
                    'level' => $level->value,
                    'source' => $this->describe($source, $sourceVehicles),
                    'target' => $this->describe($target, $targetVehicles),
                ],
                after: [...$summary, 'requested_by' => $requester->getKey(), 'approved_by' => $approver?->getKey()],
                reason: $reason, actor: $approver ?? $requester);

            return $summary;
        });
    }

    /**
     * @return array{id: int, name: mixed, slug: mixed, vehicles: int}
     */
    private function describe(Make|VehicleModel|Generation|Brand $row, int $vehicles): array
    {
        return ['id' => (int) $row->getKey(), 'name' => $row->getAttribute('name'), 'slug' => $row->getAttribute('slug'), 'vehicles' => $vehicles];
    }
}
