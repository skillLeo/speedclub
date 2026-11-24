<?php

namespace App\Actions\Admin\Catalog;

use App\Enums\CatalogEvent;
use App\Models\AiSpecSuggestion;
use App\Models\Generation;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * M5.9 (m5.9-contract §8, lead D-5): ADM-14 generation screen "KI-Herstellerangaben löschen" (`catalog.manage`, reason): deletes the
 * cached AI spec suggestion of a generation (wrong figures), so the next member who asks gets a new one. What members already took over
 * stays on their cars (their own confirm). Audited as `catalog.ai_specs_deleted`; returns how many rows went (0 or 1).
 */
class DeleteAiSpecSuggestions
{
    /**
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, Generation $generation, string $reason): int
    {
        StaffAtoms::ensure($staff, 'catalog.manage');
        $reason = Reason::internal($reason);

        return DB::transaction(function () use ($staff, $generation, $reason): int {
            $ids = AiSpecSuggestion::query()->where('generation_id', $generation->id)->lockForUpdate()->pluck('id')->all();

            if ($ids === []) {
                return 0;
            }

            AiSpecSuggestion::query()->whereKey($ids)->delete();

            Audit::record(CatalogEvent::AiSpecsDeleted->value, $generation,
                before: ['generation_id' => $generation->id, 'suggestions' => count($ids)],
                after: ['generation_id' => $generation->id, 'suggestions' => 0],
                reason: $reason, actor: $staff);

            return count($ids);
        });
    }
}
