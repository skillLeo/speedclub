<?php

use App\Enums\LegalDocumentKey;
use Database\Seeders\Concerns\LegalDraftRepair;
use Illuminate\Database\Migrations\Migration;

/**
 * DQ-P5-101 (Phase 5 gate): 2026_12_29_100300 and 2026_12_31_200200 published new privacy texts while the ADM-31 demo draft stayed open
 * on the older text (dev and staging: "Entwurf 6" holds version 5's text while version 8 is live); publishing it would have dropped the
 * Shop, Treffen, Forum and KI sections. Every open draft that is now older than the live text and holds no text of its own moves onto the
 * live text as the next free version (LegalDraftRepair::rebaseStale(), audited as `legal.draft_saved` by the system). A stale draft with
 * staff text in it is kept: the editor marks it and the publish is refused. Running it again finds nothing to change.
 */
return new class extends Migration
{
    public const REASON = 'Entwurf auf die aktuelle Live-Fassung umgestellt. Er basierte auf einer älteren Version und hätte beim Veröffentlichen neuere Abschnitte entfernt.';

    public function up(): void
    {
        $this->rebase();
    }

    /** Returns how many drafts it moved. */
    public function rebase(): int
    {
        $moved = 0;

        foreach (LegalDocumentKey::cases() as $key) {
            foreach (config()->array('speedclub.locales') as $locale) {
                $moved += LegalDraftRepair::rebaseStale($key, (string) $locale, self::REASON) ? 1 : 0;
            }
        }

        return $moved;
    }

    /**
     * The old draft would bring old text back; nothing to restore.
     */
    public function down(): void {}
};
