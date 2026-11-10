<?php

namespace App\Services\AppConfig;

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Services\Privacy\OrgIdentity;

/**
 * Published legal texts per locale. A locale without its own text gets the German one, which is the binding version.
 */
class LegalDocuments
{
    /** The documents a member accepts and may be asked to accept again (08_LEGAL_COMPLIANCE, ADM-31). */
    public const RECONSENT = [LegalDocumentKey::Terms, LegalDocumentKey::Privacy];

    /**
     * The newest published text of every document that has one, for the list screen (SET-17).
     *
     * @return list<LegalDocument>
     */
    public function all(string $locale): array
    {
        $documents = [];

        foreach (LegalDocumentKey::cases() as $key) {
            $document = $this->current($key, $locale);

            if ($document !== null) {
                $documents[] = $document;
            }
        }

        return $documents;
    }

    /**
     * The newest published text, or the given version of it. Its body has the `[[…]]` placeholders the org settings fill resolved
     * (ADM-52, OrgIdentity::resolve()); the stored text keeps them, and the resolved body is never written back (the attribute is
     * synced as original, so a save() of this model leaves body_md alone).
     */
    public function current(LegalDocumentKey $key, string $locale, ?string $version = null): ?LegalDocument
    {
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');

        foreach (array_unique([$locale, $locales[0]]) as $candidate) {
            $document = LegalDocument::query()
                ->where('key', $key)
                ->where('locale', $candidate)
                ->whereNotNull('published_at')
                ->where('published_at', '<=', now())
                ->when($version !== null, fn ($query) => $query->where('version', $version))
                ->orderByDesc('published_at')
                ->orderByDesc('id')
                ->first();

            if ($document !== null) {
                $document->setAttribute('body_md', app(OrgIdentity::class)->resolve((string) $document->getAttribute('body_md')));
                $document->syncOriginalAttribute('body_md');

                return $document;
            }
        }

        return null;
    }

    /**
     * The text a member reading $locale is asked to accept (MF-1): their language when its newest text was published at or after the
     * re-consent version (so accepting it clears needsReconsent()), otherwise the German text (binding), otherwise the newest text in
     * the locale the re-consent version was published in. Without a re-consent version: the newest text, as current().
     */
    public function offered(LegalDocumentKey $key, string $locale): ?LegalDocument
    {
        $current = $this->current($key, $locale);
        $reconsent = $this->reconsentDocument($key);

        if ($reconsent === null || $current === null || self::clears($current, $reconsent)) {
            return $current;
        }

        /** @var list<string> $locales */
        $locales = config('speedclub.locales');

        foreach (array_unique([$locales[0], $reconsent->locale]) as $candidate) {
            $document = $this->current($key, $candidate);

            if ($document !== null && self::clears($document, $reconsent)) {
                return $document;
            }
        }

        // Not reachable: the re-consent locale's newest text is the re-consent version or a later one.
        return $current;
    }

    /**
     * The newest published version of $key that asked members to accept again, in any locale (the German text binds), else null.
     */
    public function reconsentVersion(LegalDocumentKey $key): ?string
    {
        return $this->reconsentDocument($key)?->version;
    }

    public function reconsentDocument(LegalDocumentKey $key): ?LegalDocument
    {
        return LegalDocument::query()
            ->where('key', $key)
            ->where('requires_reconsent', true)
            ->whereNotNull('published_at')
            ->where('published_at', '<=', now())
            ->orderByDesc('published_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Whether a member who accepted $acceptedVersion of $key must accept again: a re-consent version exists and $acceptedVersion is
     * none of the versions published at or after it.
     */
    public function needsReconsent(LegalDocumentKey $key, ?string $acceptedVersion): bool
    {
        $required = $this->reconsentDocument($key);

        if ($required === null) {
            return false;
        }

        return $acceptedVersion === null || ! LegalDocument::query()
            ->where('key', $key)
            ->where('version', $acceptedVersion)
            ->whereNotNull('published_at')
            ->where('published_at', '>=', $required->published_at)
            ->where('published_at', '<=', now())
            ->exists();
    }

    /** Whether accepting $document's version satisfies the re-consent version (published at or after it, needsReconsent()). */
    private static function clears(LegalDocument $document, LegalDocument $reconsent): bool
    {
        return $document->published_at !== null && $reconsent->published_at !== null && $document->published_at->greaterThanOrEqualTo($reconsent->published_at);
    }
}
