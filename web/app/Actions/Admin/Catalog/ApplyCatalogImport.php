<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\ApprovalStatus;
use App\Enums\CatalogEvent;
use App\Enums\CatalogImportStatus;
use App\Jobs\Catalog\RunCatalogImport;
use App\Models\ApprovalRequest;
use App\Models\CatalogImport;
use App\Models\Staff;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Catalog\CatalogRefused;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

/**
 * ADM-17 "Übernehmen" (`catalog.import` and `catalog.manage`, reason): queues RunCatalogImport, which applies the rows through the
 * Actions of a manual edit. Four-eyes (`catalog.import_apply`) when the import changes more than 100 rows together with what the same
 * staff member imported without approval in the last 24 hours (ADR-229), or while another apply of theirs is being asked for; its
 * handler calls execute() from Approvals::approve(), nowhere else (FourEyes). Only an analysed import whose file is unchanged and not
 * expired can go (`import_state`, `import_file_changed`, `import_expired`); an import whose approval was denied or expired can be asked
 * for again. `catalog.import_started` carries the changed rows as `records`.
 */
class ApplyCatalogImport
{
    public function __construct(private readonly Approvals $approvals) {}

    /**
     * @throws AuthorizationException|ValidationException|CatalogRefused
     */
    public function handle(Staff $staff, CatalogImport $import, string $reason): CatalogImport|ApprovalRequest
    {
        StaffAtoms::ensure($staff, 'catalog.import', 'catalog.manage');
        $reason = Reason::required($reason);
        self::ensureApplicable($import->refresh());

        $ask = function () use ($staff, $import, $reason): ApprovalRequest {
            $approval = $this->approvals->request('catalog.import_apply', ['import_id' => $import->id], $reason, $staff);

            DB::transaction(function () use ($import, $approval): void {
                CatalogImport::query()->whereKey($import->id)->update([
                    'status' => CatalogImportStatus::AwaitingApproval->value,
                    'approval_id' => $approval->getKey(),
                    'updated_at' => now(),
                ]);
            });

            return $approval;
        };

        return BulkRunner::alone($staff, 'catalog.import', $ask, function () use ($staff, $import, $reason, $ask): CatalogImport|ApprovalRequest {
            if ($import->changedRows() + BulkRunner::recentDirect($staff, CatalogEvent::ImportStarted->value) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return $this->queue($staff, null, $import, $reason);
        });
    }

    /**
     * The approved apply: only from the `catalog.import_apply` handler while Approvals::approve() executes that request (FourEyes), for
     * the import it names.
     *
     * @throws AuthorizationException|CatalogRefused
     */
    public function execute(Staff $requester, Staff $approver, CatalogImport $import, string $reason): CatalogImport
    {
        $request = FourEyes::executor(['catalog.import_apply'], $requester, $approver, 'catalog.import', 'catalog.manage');

        if (($request->payload['import_id'] ?? null) !== $import->id) {
            throw new AuthorizationException('The approval names another import.');
        }

        return $this->queue($requester, $approver, $import, $reason);
    }

    /**
     * $forApproval: the check of the `catalog.import_apply` handler, for which waiting on its own approval is the expected state.
     *
     * @throws CatalogRefused
     */
    public static function ensureApplicable(CatalogImport $import, bool $forApproval = false): void
    {
        $waiting = $import->status === CatalogImportStatus::AwaitingApproval
            && ApprovalRequest::query()->whereKey($import->approval_id)->where('status', ApprovalStatus::Pending)->exists();
        $state = $import->status === CatalogImportStatus::Analysed
            || ($import->status === CatalogImportStatus::AwaitingApproval && ($forApproval || ! $waiting));

        if (! $state) {
            throw new CatalogRefused('import_state');
        }

        if ($import->expires_at !== null && $import->expires_at->isPast()) {
            throw new CatalogRefused('import_expired');
        }

        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

        if (! $disk->exists($import->path) || hash('sha256', (string) $disk->get($import->path)) !== $import->file_hash) {
            throw new CatalogRefused('import_file_changed');
        }
    }

    private function queue(Staff $requester, ?Staff $approver, CatalogImport $import, string $reason): CatalogImport
    {
        return DB::transaction(function () use ($requester, $approver, $import, $reason): CatalogImport {
            /** @var CatalogImport $locked */
            $locked = CatalogImport::query()->whereKey($import->id)->lockForUpdate()->firstOrFail();

            if ($approver === null) {
                self::ensureApplicable($locked);
            } elseif ($locked->status !== CatalogImportStatus::AwaitingApproval) {
                throw new CatalogRefused('import_state');
            }

            $locked->forceFill([
                'status' => CatalogImportStatus::Queued,
                'applied_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
                'reason' => $reason,
                'progress' => 0,
                'results' => [],
                'queued_at' => now(),
            ])->save();

            Audit::record(CatalogEvent::ImportStarted->value, null, after: [
                'import_id' => $locked->id,
                'kind' => $locked->kind->value,
                'records' => $locked->changedRows(),
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver?->getKey(),
            ], reason: $reason, actor: $approver ?? $requester);

            $id = $locked->id;
            DB::afterCommit(fn () => RunCatalogImport::dispatch($id));

            return $locked;
        });
    }
}
