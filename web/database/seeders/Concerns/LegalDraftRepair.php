<?php

namespace Database\Seeders\Concerns;

use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Services\Audit\Audit;
use App\Services\Content\LegalDrafts;
use Database\Seeders\BrandContentDemoSeeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * DQ-P5-101: the system writes that keep an ADM-31 draft from being older than the live text. A data migration that publishes a new
 * legal text (2026_12_29_100300, 2026_12_31_200200) and the repair 2026_12_31_300100 call rebaseStale(): an open draft of the same
 * document and locale that is now stale is moved onto the live text, as long as it holds no text of its own, i.e. its body is a
 * published version's body, or that body with the ADM-31 demo sentence (BrandContentDemoSeeder). A draft staff wrote text into is left
 * as it is: nothing of theirs is thrown away, the editor shows it as stale and PublishLegalDocument refuses to publish it. A draft whose
 * re-consent publish waits for approval is left too (the approver reads exactly that text; the approval now fails on execution).
 */
final class LegalDraftRepair
{
    /**
     * The newest published version whose text the draft holds unchanged (the demo sentence aside), or null when the draft has text of
     * its own.
     *
     * @param  Collection<int, LegalDocument>  $rows  every version of the draft's document and locale
     */
    public static function untouchedBase(LegalDocument $draft, Collection $rows): ?LegalDocument
    {
        $bodies = array_values(array_filter([$draft->body_md, BrandContentDemoSeeder::withoutDemoSentence($draft->body_md)]));

        return $rows
            ->filter(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at->lessThanOrEqualTo(now()) && in_array($row->body_md, $bodies, true))
            ->sortByDesc(fn (LegalDocument $row): string => $row->published_at?->format('Y-m-d H:i:s.u').sprintf('%020d', $row->id))
            ->first();
    }

    /**
     * Moves the open draft of the document and locale onto the live text when it is stale and holds no text of its own; returns whether
     * it did. The draft gets the live body (with the demo sentence when it carried it), the next free whole version and the live version
     * as its base; re-consent and summary stay. Audited as `legal.draft_saved` by the system with $reason.
     */
    public static function rebaseStale(LegalDocumentKey $key, string $locale, string $reason): bool
    {
        return DB::transaction(function () use ($key, $locale, $reason): bool {
            $rows = LegalDocument::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->get();
            $draft = $rows->first(fn (LegalDocument $row): bool => $row->published_at === null);
            $live = LegalDrafts::live($key, $locale);

            if ($draft === null || $live === null || LegalDrafts::staleness($draft, $live) === null || self::untouchedBase($draft, $rows) === null) {
                return false;
            }

            $waiting = ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->where('status', ApprovalStatus::Pending)
                ->where('subject_type', $draft->getMorphClass())->where('subject_id', (string) $draft->getKey())->exists();

            if ($waiting) {
                return false;
            }

            $demo = BrandContentDemoSeeder::withoutDemoSentence($draft->body_md) !== null;
            $body = $demo ? (BrandContentDemoSeeder::withDemoSentence($live->body_md) ?? $live->body_md) : $live->body_md;
            $numbers = array_map(intval(...), array_filter($rows->pluck('version')->all(), ctype_digit(...)));

            $before = SaveLegalDraft::describe($draft);
            $draft->fill([
                'version' => (string) (max([0, ...$numbers]) + 1),
                'body_md' => $body,
                'summary' => $demo ? BrandContentDemoSeeder::PRIVACY_DRAFT_SUMMARY : $draft->summary,
            ]);

            // A host that runs the publish migrations before 2026_12_31_300000 has no column yet; that migration fills it.
            if (Schema::hasColumn('legal_documents', 'based_on_id')) {
                $draft->setAttribute('based_on_id', $live->id);
            }

            $draft->save();

            Audit::record(ContentEvent::LegalDraftSaved->value, $draft, before: $before,
                after: [...SaveLegalDraft::describe($draft), 'based_on' => $live->version], reason: $reason);

            return true;
        });
    }
}
