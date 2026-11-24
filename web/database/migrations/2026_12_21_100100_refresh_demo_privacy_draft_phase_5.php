<?php

use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Services\Audit\Audit;
use Database\Seeders\BrandContentDemoSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * M5.9f: the same repair as 2026_12_10_100100 one phase later. The ADM-31 demo draft of the German Datenschutzerklärung
 * (BrandContentDemoSeeder::privacyDraft(): the current data file plus the demo sentence, re-consent on) still holds the Phase 4 text on a
 * local or staging host seeded before 2026_12_21_100000 published the Phase 5 drafts; publishing it in ADM-31 would replace the Phase 5
 * text with the Phase 4 one. Every unpublished draft whose body is the Phase 4 demo draft (OLD_DRAFTS) becomes the current
 * privacyDraft(), as the next free version. A draft staff changed, or one whose re-consent publish waits for approval, is left to
 * ADM-31. Production holds no demo draft. Audited as `legal.draft_saved` by the system. Running it again finds nothing to change.
 */
return new class extends Migration
{
    /** @var list<string> SHA-256 of the body the demo seeder gave its privacy draft from the Phase 4 text (2026_12_09_100000). */
    public const OLD_DRAFTS = [
        'fd93cf56e68916c53f17ef731bac857f1ce8b2e554c990db8772a2c697ee32cf',
    ];

    public function up(): void
    {
        $this->refresh(self::OLD_DRAFTS);
    }

    /**
     * Rewrites the draft when its body hash is listed; returns whether it did. up() passes OLD_DRAFTS; tests pass the hash of a body they
     * wrote.
     *
     * @param  list<string>  $hashes
     */
    public function refresh(array $hashes): bool
    {
        return DB::transaction(function () use ($hashes): bool {
            $draft = LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->where('locale', 'de')->whereNull('published_at')->lockForUpdate()->first();

            if ($draft === null || ! in_array(hash('sha256', $draft->body_md), $hashes, true)) {
                return false;
            }

            $waiting = ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->where('status', ApprovalStatus::Pending)
                ->where('subject_type', $draft->getMorphClass())->where('subject_id', (string) $draft->getKey())->exists();

            if ($waiting) {
                return false;
            }

            $before = SaveLegalDraft::describe($draft);
            $draft->fill(BrandContentDemoSeeder::privacyDraft())->save();

            Audit::record(ContentEvent::LegalDraftSaved->value, $draft, before: $before, after: SaveLegalDraft::describe($draft),
                reason: 'Demo-Entwurf auf den Phase-5-Text umgestellt (M5.9f).');

            return true;
        });
    }

    /**
     * The old draft brought old text back; nothing to restore.
     */
    public function down(): void {}
};
