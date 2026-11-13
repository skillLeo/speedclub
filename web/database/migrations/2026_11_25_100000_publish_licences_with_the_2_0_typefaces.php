<?php

use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * M4.1 (ADR-402): the apps and the web now ship Inter, Inter Display and Archivo, and Barlow Semi Condensed is gone. The licences page
 * (SET-17, /lizenzen) of a host seeded before M4.1 still names Barlow, and LegalDocumentSeeder never touches an existing row. So every
 * locale whose current licences text still carries the Barlow row gets a new published version with the two font rows exchanged.
 *
 * Licences are informational: they are not in LegalDocuments::RECONSENT, the new row has requires_reconsent off, so no member is asked
 * to accept anything. Only the two table rows change, everything else a staff member wrote in ADM-31 stays as it is; a text whose Barlow
 * row was reworded is left for ADM-31. Published by the system and audited as `legal.published`, like an ADM-31 publish. Running it again
 * finds no Barlow row and changes nothing; a fresh install has no licences row yet and gets the new text from the seeder.
 */
return new class extends Migration
{
    /** @var array<string, array<string, string>> per locale: the v1 font rows and their 2.0 replacements (database/data/legal). */
    public const ROWS = [
        'de' => [
            '| Inter (Schriftart) | SIL Open Font License 1.1 |' => '| Inter und Inter Display (Schriftarten) | SIL Open Font License 1.1 |',
            '| Barlow Semi Condensed (Schriftart) | SIL Open Font License 1.1 |' => '| Archivo (Schriftart) | SIL Open Font License 1.1 |',
        ],
        'en' => [
            '| Inter (typeface) | SIL Open Font License 1.1 |' => '| Inter and Inter Display (typefaces) | SIL Open Font License 1.1 |',
            '| Barlow Semi Condensed (typeface) | SIL Open Font License 1.1 |' => '| Archivo (typeface) | SIL Open Font License 1.1 |',
        ],
    ];

    public const REASON = 'Schriften 2.0 (ADR-402): Inter Display und Archivo statt Barlow Semi Condensed. Nur Lizenzangaben, keine erneute Zustimmung.';

    public function up(): void
    {
        $published = 0;

        foreach (self::ROWS as $locale => $rows) {
            $published += DB::transaction(function () use ($locale, $rows): int {
                $versions = LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->where('locale', $locale)->lockForUpdate()->get();
                // The raw stored text (LegalDocuments::current() would resolve the [[…]] placeholders, and those must stay in the row).
                $current = $versions
                    ->filter(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at->lessThanOrEqualTo(now()))
                    ->sortByDesc(fn (LegalDocument $row): string => $row->published_at?->format('Y-m-d H:i:s.u').sprintf('%020d', $row->id))
                    ->first();
                $barlow = array_key_last($rows);

                if ($current === null || ! str_contains($current->body_md, $barlow)) {
                    return 0;
                }

                $version = $this->nextVersion($current->version, $versions->map(fn (LegalDocument $row): string => $row->version)->all());
                $document = LegalDocument::query()->create([
                    'key' => LegalDocumentKey::Licenses,
                    'locale' => $locale,
                    'version' => $version,
                    'body_md' => strtr($current->body_md, $rows),
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

        // SET-17 and app-config's legal_versions read the newest text; the cached copy would show v1 until it expires.
        if ($published > 0) {
            app(AppConfig::class)->flush();
        }
    }

    /**
     * Published texts are history (a member may have read one); nothing is taken back.
     */
    public function down(): void {}

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
