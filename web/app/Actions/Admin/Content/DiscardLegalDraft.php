<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\LegalDocument;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-31 "Entwurf verwerfen" (`content.edit`): deletes an unpublished legal_documents row. A published version is never deleted.
 */
final class DiscardLegalDraft
{
    /**
     * @throws AuthorizationException|ConfigRefused
     */
    public function handle(Staff $staff, LegalDocument $draft): void
    {
        StaffAtoms::ensure($staff, 'content.edit');

        DB::transaction(function () use ($staff, $draft): void {
            $locked = LegalDocument::query()->whereKey($draft->getKey())->lockForUpdate()->first();

            if ($locked === null || $locked->published_at !== null) {
                throw new ConfigRefused('legal_not_draft');
            }

            $locked->delete();

            Audit::record(ContentEvent::LegalDraftDiscarded->value, $locked, before: SaveLegalDraft::describe($locked), actor: $staff);
        });
    }
}
