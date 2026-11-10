<?php

namespace App\Services\Privacy;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * ADM-52 org settings (config key `org`, Owner only; OrgSchema): the operator's identity for the Impressum, the privacy policy and the
 * mails. The legal texts keep `[[…]]` placeholders until the owner fills them (OA-10); resolve() replaces each placeholder whose field is
 * set and leaves the others, so a missing value stays visible as a placeholder instead of an empty line.
 */
final class OrgIdentity
{
    public const CACHE_KEY = 'org:live';

    /** The fields of `org`, in the order ADM-52 shows them. */
    public const FIELDS = [
        'company_name', 'legal_form', 'street', 'postal_city', 'representative', 'responsible_person', 'contact_email', 'phone',
        'support_email', 'privacy_email', 'dsa_email', 'report_email', 'register_court', 'register_number', 'vat_id',
        'supervisory_authority', 'default_locale',
    ];

    public const EMAIL_FIELDS = ['contact_email', 'support_email', 'privacy_email', 'dsa_email', 'report_email'];

    /** Placeholder text of the legal documents (database/data/legal/*.md) => org field. */
    public const PLACEHOLDERS = [
        'Firmenname' => 'company_name',
        'Rechtsform' => 'legal_form',
        'Anschrift' => 'street',
        'PLZ und Ort' => 'postal_city',
        'Vertretungsberechtigte Person' => 'representative',
        'Verantwortliche Person' => 'responsible_person',
        'Kontakt-E-Mail' => 'contact_email',
        'Kontaktformular oder Support-Adresse' => 'support_email',
        'Datenschutz-E-Mail' => 'privacy_email',
        'DSA-Kontakt-E-Mail' => 'dsa_email',
        'Melde-E-Mail' => 'report_email',
        'Registergericht' => 'register_court',
        'Registernummer' => 'register_number',
        'USt-IdNr.' => 'vat_id',
        'Zuständige Aufsichtsbehörde' => 'supervisory_authority',
    ];

    /**
     * The published values, every field present (null when not set).
     *
     * @return array<string, string|null>
     */
    public function values(): array
    {
        /** @var array<string, mixed> $live */
        $live = Cache::rememberForever(self::CACHE_KEY, function (): array {
            $row = ConfigVersion::query()->where('key', ConfigKey::Org->value)->where('status', ConfigVersionStatus::Published)
                ->orderByDesc('version')->first();

            return $row !== null ? $row->payload : [];
        });

        $values = [];

        foreach (self::FIELDS as $field) {
            $value = $live[$field] ?? null;
            $values[$field] = is_string($value) && trim($value) !== '' ? trim($value) : null;
        }

        return $values;
    }

    public function get(string $field): ?string
    {
        return $this->values()[$field] ?? null;
    }

    /** de or en: the org's default locale (fallback: the first of speedclub.locales). */
    public function defaultLocale(): string
    {
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');
        $locale = $this->get('default_locale');

        return is_string($locale) && in_array($locale, $locales, true) ? $locale : $locales[0];
    }

    /**
     * The request's language: the best Accept-Language match among speedclub.locales, else the org's default locale. The org setting is
     * read only when the header matches nothing we have, so the common request (a matching header) costs no lookup (review: query
     * counts of the public vehicle page must not depend on which request came first).
     */
    public function forRequest(Request $request): string
    {
        /** @var list<string> $supported */
        $supported = config()->array('speedclub.locales');

        foreach ($request->getLanguages() as $language) {
            $primary = strtolower(substr(str_replace('_', '-', $language), 0, 2));

            if (in_array($primary, $supported, true)) {
                return (string) $request->getPreferredLanguage($supported);
            }
        }

        return $this->defaultLocale();
    }

    /** $locale when it is supported, else the org's default locale. */
    public function localeOr(mixed $locale): string
    {
        return is_string($locale) && in_array($locale, config()->array('speedclub.locales'), true) ? $locale : $this->defaultLocale();
    }

    /**
     * Replaces every `[[Placeholder]]` of PLACEHOLDERS whose field is set. Values are plain text; Markdown control characters are
     * escaped, so a value cannot add a link or formatting to a legal text.
     */
    public function resolve(string $markdown): string
    {
        $values = $this->values();

        return (string) preg_replace_callback('/\[\[([^\[\]]{1,120})\]\]/u', function (array $match) use ($values): string {
            $field = self::PLACEHOLDERS[$match[1]] ?? null;
            $value = $field === null ? null : ($values[$field] ?? null);

            return $value === null ? $match[0] : self::escape($value);
        }, $markdown);
    }

    public static function forget(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    private static function escape(string $value): string
    {
        return (string) preg_replace('/([\\\\`*_{}\[\]()#+\-!<>|~])/', '\\\\$1', $value);
    }
}
