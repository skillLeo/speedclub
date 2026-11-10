<?php

namespace App\Services\Content;

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\AppConfig\LegalDocuments;
use Illuminate\Support\Carbon;

/**
 * A member's consent to AGB and Datenschutz (08_LEGAL_COMPLIANCE, ADM-31 re-consent). users.terms_version / privacy_version hold the
 * versions they accepted (at registration, RegisterMember, or here), consented_at the last acceptance. A document needs acceptance
 * again when a version published with requires_reconsent exists and the member's version is none published at or after it
 * (LegalDocuments::needsReconsent()). The version offered is their language's only when that text clears the re-consent, else the
 * German one (LegalDocuments::offered()).
 *
 * @phpstan-type Required array{key: string, version: string, summary: string|null, published_at: string|null}
 * @phpstan-type State array{required: list<Required>, accepted: array{terms: string|null, privacy: string|null}, consented_at: string|null}
 */
final class Consents
{
    public function __construct(private readonly LegalDocuments $documents) {}

    /**
     * @return State
     */
    public function state(User $member): array
    {
        $required = [];
        $locale = self::locale($member);

        foreach (LegalDocuments::RECONSENT as $key) {
            $accepted = $this->accepted($member, $key);

            if (! $this->documents->needsReconsent($key, $accepted)) {
                continue;
            }

            $current = $this->documents->offered($key, $locale);

            if ($current instanceof LegalDocument) {
                $summary = $current->summary ?? $this->reconsentSummary($key, $current->locale);

                $required[] = [
                    'key' => $key->value,
                    'version' => $current->version,
                    'summary' => $summary,
                    'published_at' => $current->published_at?->toIso8601ZuluString(),
                ];
            }
        }

        $consentedAt = $member->getAttribute('consented_at');

        return [
            'required' => $required,
            'accepted' => [
                'terms' => $this->accepted($member, LegalDocumentKey::Terms),
                'privacy' => $this->accepted($member, LegalDocumentKey::Privacy),
            ],
            'consented_at' => $consentedAt instanceof Carbon ? $consentedAt->toIso8601ZuluString() : null,
        ];
    }

    /**
     * ADR-245: whether the member still has to accept a re-consent version of AGB or Datenschutz (EnsureCurrentConsent refuses their
     * writes meanwhile). Two light queries when nothing asks for re-consent.
     */
    public function outstanding(User $member): bool
    {
        foreach (LegalDocuments::RECONSENT as $key) {
            if ($this->documents->needsReconsent($key, $this->accepted($member, $key))) {
                return true;
            }
        }

        return false;
    }

    /**
     * The member's own language when the platform has it, else the fallback (German, the binding text).
     */
    public static function locale(User $member): string
    {
        /** @var list<string> $locales */
        $locales = config()->array('speedclub.locales');
        $locale = $member->getAttribute('locale');

        return is_string($locale) && in_array($locale, $locales, true) ? $locale : $locales[0];
    }

    /**
     * The version of $key the member is offered and may accept (MF-1): state() lists it, POST me/consents accepts exactly it. Their
     * language only when that text is at or after the re-consent version, else the German one (LegalDocuments::offered()), so
     * accepting what is offered always clears the re-consent.
     */
    public function offeredVersion(User $member, LegalDocumentKey $key): ?string
    {
        return $this->documents->offered($key, self::locale($member))?->version;
    }

    public static function column(LegalDocumentKey $key): string
    {
        return $key === LegalDocumentKey::Privacy ? 'privacy_version' : 'terms_version';
    }

    /**
     * The "what changed" note of the re-consent version when the current text has none: in the member's language, else German, else
     * whatever locale it was published in.
     */
    private function reconsentSummary(LegalDocumentKey $key, string $locale): ?string
    {
        $reconsent = $this->documents->reconsentDocument($key);

        if ($reconsent === null) {
            return null;
        }

        if ($reconsent->locale === $locale && $reconsent->summary !== null) {
            return $reconsent->summary;
        }

        return $this->documents->current($key, $locale, $reconsent->version)->summary ?? $reconsent->summary;
    }

    private function accepted(User $member, LegalDocumentKey $key): ?string
    {
        $value = $member->getAttribute(self::column($key));

        return is_string($value) && $value !== '' ? $value : null;
    }
}
