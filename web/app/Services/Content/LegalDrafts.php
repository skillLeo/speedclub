<?php

namespace App\Services\Content;

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;

/**
 * Which published text an ADM-31 draft was started from, and whether a newer one went live since (DQ-P5-101). A draft keeps the text
 * of its base version plus the editor's changes; publishing a draft whose base is older than the live text would silently drop every
 * section the newer versions added. PublishLegalDocument refuses such a draft (legal_draft_stale), the editor shows both versions and
 * offers to start again from the live text.
 *
 * The base is `based_on_id` (set by SaveLegalDraft when it creates the draft). A draft from before that column, or one whose base row
 * is gone, counts as based on the version that was live when it was created, which errs towards "stale".
 */
final class LegalDrafts
{
    /**
     * The newest live text of the document in exactly this locale (the stored row, placeholders unresolved; no fallback to German, unlike
     * LegalDocuments::current()), or null.
     */
    public static function live(LegalDocumentKey $key, string $locale): ?LegalDocument
    {
        return LegalDocument::query()
            ->where('key', $key)
            ->where('locale', $locale)
            ->whereNotNull('published_at')
            ->where('published_at', '<=', now())
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * The published version the draft was started from, or null when nothing was live then.
     */
    public static function base(LegalDocument $draft): ?LegalDocument
    {
        $basedOn = $draft->getAttribute('based_on_id');

        if (is_numeric($basedOn)) {
            $base = LegalDocument::query()->whereKey((int) $basedOn)->whereNotNull('published_at')->first();

            if ($base !== null) {
                return $base;
            }
        }

        if ($draft->created_at === null) {
            return null;
        }

        return LegalDocument::query()
            ->where('key', $draft->key)
            ->where('locale', $draft->locale)
            ->whereNotNull('published_at')
            ->where('published_at', '<=', $draft->created_at)
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Null when the draft is based on the live text (or nothing is live); otherwise the two versions: `base` (null when the draft was
     * started before any version was live) and `live`.
     *
     * @return array{base: string|null, live: string}|null
     */
    public static function staleness(LegalDocument $draft, ?LegalDocument $live = null): ?array
    {
        if ($draft->published_at !== null) {
            return null;
        }

        $live ??= self::live($draft->key, $draft->locale);

        if ($live === null) {
            return null;
        }

        $base = self::base($draft);

        return $base !== null && $base->is($live) ? null : ['base' => $base?->version, 'live' => $live->version];
    }

    /**
     * The refusal reason for a stale draft: with the base version, or for a draft begun before any version was live.
     *
     * @param  array{base: string|null, live: string}  $staleness
     */
    public static function refusal(array $staleness): string
    {
        return $staleness['base'] === null ? 'legal_draft_stale_first' : 'legal_draft_stale';
    }
}
