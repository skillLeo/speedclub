<?php

use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * M5.9b part 2 (ADR-508): STREET DEX ships the German places of GeoNames (de_cities, /geo/de-cities.json), licensed CC BY 4.0, which
 * asks for attribution. The licences page (SET-17, /lizenzen) of a host seeded before M5.9b lacks it, and LegalDocumentSeeder never
 * touches an existing row. So every locale whose current licences text does not name GeoNames gets a new published version with the
 * "Daten" section of database/data/legal/licenses.{locale}.md inserted before the closing paragraph (or at the end when staff reworded
 * that paragraph in ADM-31); everything else in the text stays as it is.
 *
 * Licences are informational: not in LegalDocuments::RECONSENT, requires_reconsent off, so no member is asked to accept anything.
 * Published by the system and audited as `legal.published`, like the M4.1 typefaces update. Running it again finds GeoNames and changes
 * nothing; a fresh install has no licences row yet and gets the text from the seeder.
 */
return new class extends Migration
{
    /** @var array<string, array{section: string, before: string}> per locale: the section and the paragraph it goes in front of. */
    public const SECTIONS = [
        'de' => [
            'section' => "## Daten\n\nOrtsdaten: GeoNames ([geonames.org](https://www.geonames.org/)), CC BY 4.0 ([Lizenz](https://creativecommons.org/licenses/by/4.0/deed.de)). Für STREET DEX haben wir die Liste auf Orte in Deutschland ab 1.000 Einwohnern gekürzt und die deutschen Ortsnamen übernommen.\n\n",
            'before' => 'Die vollständige Liste',
        ],
        'en' => [
            'section' => "## Data\n\nPlace data: GeoNames ([geonames.org](https://www.geonames.org/)), CC BY 4.0 ([licence](https://creativecommons.org/licenses/by/4.0/)). For STREET DEX we reduced the list to places in Germany with at least 1,000 inhabitants and use the German place names.\n\n",
            'before' => 'We will add the full list',
        ],
    ];

    public const REASON = 'STREET DEX: Namensnennung der Ortsdaten von GeoNames (CC BY 4.0). Nur Lizenzangaben, keine erneute Zustimmung.';

    public function up(): void
    {
        $published = 0;

        foreach (self::SECTIONS as $locale => $section) {
            $published += DB::transaction(function () use ($locale, $section): int {
                $versions = LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->where('locale', $locale)->lockForUpdate()->get();
                // The raw stored text (LegalDocuments::current() would resolve the [[…]] placeholders, and those must stay in the row).
                $current = $versions
                    ->filter(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at->lessThanOrEqualTo(now()))
                    ->sortByDesc(fn (LegalDocument $row): string => $row->published_at?->format('Y-m-d H:i:s.u').sprintf('%020d', $row->id))
                    ->first();

                if ($current === null || str_contains($current->body_md, 'GeoNames')) {
                    return 0;
                }

                $version = $this->nextVersion($current->version, $versions->map(fn (LegalDocument $row): string => $row->version)->all());
                $document = LegalDocument::query()->create([
                    'key' => LegalDocumentKey::Licenses,
                    'locale' => $locale,
                    'version' => $version,
                    'body_md' => self::withSection($current->body_md, $section['section'], $section['before']),
                    'requires_reconsent' => false,
                    'summary' => null,
                    'published_at' => now(),
                    'reason' => self::REASON,
                ]);

                Audit::record(ContentEvent::LegalPublished->value, $document,
                    before: ['key' => LegalDocumentKey::Licenses->value, 'locale' => $locale, 'version' => $current->version],
                    after: ['key' => LegalDocumentKey::Licenses->value, 'locale' => $locale, 'version' => $version, 'requires_reconsent' => false, 'summary' => null, 'body_sha256' => hash('sha256', $document->body_md)],
                    reason: self::REASON);

                return 1;
            });
        }

        // SET-17 and app-config's legal_versions read the newest text; the cached copy would keep the old one until it expires.
        if ($published > 0) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Published texts are history (a member may have read one); nothing is taken back.
     */
    public function down(): void {}

    /**
     * $body with $section in front of the line that starts with $before, else at the end.
     */
    public static function withSection(string $body, string $section, string $before): string
    {
        $at = strpos($body, "\n".$before);

        return $at === false ? rtrim($body)."\n\n".rtrim($section)."\n" : substr($body, 0, $at + 1).$section.substr($body, $at + 1);
    }

    /**
     * The next whole number after the current version that no row of this document and locale (a draft included) uses yet.
     *
     * @param  array<int, string>  $taken  every version of the document and locale
     */
    private function nextVersion(string $current, array $taken): string
    {
        $number = ctype_digit($current) ? (int) $current + 1 : count($taken) + 1;

        while (in_array((string) $number, $taken, true)) {
            $number++;
        }

        return (string) $number;
    }
};
