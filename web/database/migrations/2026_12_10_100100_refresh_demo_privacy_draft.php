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
 * M4.18: the ADM-31 demo draft of the German Datenschutzerklärung (BrandContentDemoSeeder, re-consent on) was the text published when
 * the demo was seeded plus a "QR-Scans" paragraph. On a local or staging host seeded before 2026_12_09_100000 it still holds the
 * pre-Phase-4 text, with version "2" below the published "3": publishing it would bring the old text back. Every unpublished draft whose
 * body is one the seeder wrote (OLD_DRAFTS: SHA-256 of each earlier privacy.de.md body plus that paragraph, and of the fallback text)
 * becomes BrandContentDemoSeeder::privacyDraft(): the current data file with the demo sentence, as the next free version.
 *
 * A draft staff changed matches no hash and is left to ADM-31, as is one whose re-consent publish waits for approval. Production holds
 * no demo draft, so nothing changes there. Audited as `legal.draft_saved` by the system. Running it again finds nothing to change.
 */
return new class extends Migration
{
    /** @var list<string> SHA-256 of every body the demo seeder gave its privacy draft before M4.18. */
    public const OLD_DRAFTS = [
        '5cfd98aab2f4fbd174c0d388d16eac7766f5056b21715af6cdfdd61d44986617',
        'a25dc2908345da7f50d0601550ab85f5ab0671584e14073758e2f68ec5ca523d',
        'be48105ebb76ed3e890c8bd1e7945db28dc06ab6604ccb876512476676de839f',
        'fa28c37c4ad85b85c8937e9ddb465da85074155b805a3acb935672988f31ca89',
        '1172d2f6a7d0bd160c6c7e1dc9b7a6d4c90dbd2337facb33eef62be13fac0e39',
        '3812f4b89f738ffdde8208c523ad04f0131c3f7fd52abc92ad924ea1f516b506',
        // The Phase 4 text of 2026_12_09_100000 with the paragraph appended after "Stand:" (a demo seeded between that and this).
        '1981fa338d82a0900b93934a60a97b493e4fc9c28bb224cc3ce3a173394942df',
        // The fallback when no text was published yet.
        '9f7deb4f5b03e843fcaa4c12f4220dc875d076dfcd0eecbe7ab48dab5f3424f0',
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
                reason: 'Demo-Entwurf auf den Phase-4-Text umgestellt (M4.18).');

            return true;
        });
    }

    /**
     * The old draft brought old text back; nothing to restore.
     */
    public function down(): void {}
};
