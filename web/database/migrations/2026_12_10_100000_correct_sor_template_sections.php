<?php

use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * M4.18 (docs/legal/phase-4-changes.md §7 item 2): three statement-of-reasons templates of ADM-24, as 2026_11_20_100000 seeded them,
 * cite a section that does not match the headings of the AGB and Community-Richtlinien (database/data/legal): impersonation cites
 * AGB "6" (QR-Sticker; the rule is § 3 Konto), nudity Community "3" (Nur Legales; it is § 4 Deine Inhalte) and spam Community "4"
 * (it is § 6 Kein Spam). Harassment (Community § 2 Respekt) is right; illegal and street racing cite the law, without a section.
 *
 * Only a row whose content is still exactly the seeded one changes (SEEDED: SHA-256 of action, label, facts, ground, document and
 * section): a template staff edited in ADM-24 matches no hash and is left to them. Audited as `moderation.template_saved` by the
 * system. Running it again finds nothing to change; a fresh install already seeds the right sections (2026_11_20_100000 since M4.18), so
 * nothing matches there and no audit row is written.
 */
return new class extends Migration
{
    /** @var array<string, array{section: string, hashes: array<string, string>}> per template key: the right section, the seeded hash per locale. */
    public const SEEDED = [
        'spam' => ['section' => '6', 'hashes' => [
            'de' => '58542c97d541ef0471ef76b35b729205813c164cd9f2db4aea7a13432c43493a',
            'en' => '37fbdf1deeaa0c1f7d642feed4b287732558f4de9d28471b70b08467b5ffb152',
        ]],
        'impersonation' => ['section' => '3', 'hashes' => [
            'de' => '2ff958bb66a7b245775f45f690130b462ec14f796cac0117aa227da733e9a43e',
            'en' => '53b79edd2f9b823318b0ef251054ee45e2d38b8c7a63942ccab6a0c3580c194d',
        ]],
        'nudity' => ['section' => '4', 'hashes' => [
            'de' => '61507abe8946ee94904ca235b67d4fae84fd36d95e94c340d092f8add8cea1cf',
            'en' => '6f99a8ba93c874f650c96c74944d6aa2e4ba8d5ac385e83bce0fdc7a842d5e5f',
        ]],
    ];

    public const REASON = 'Abschnittsnummern an die Phase-4-Entwürfe von AGB und Community-Richtlinien angepasst (M4.18).';

    public function up(): void
    {
        $this->correct(self::SEEDED);
    }

    /**
     * Sets the section of every template whose content hash is listed; returns how many rows changed. up() passes SEEDED; tests pass the
     * hash of a row they wrote.
     *
     * @param  array<string, array{section: string, hashes: array<string, string>}>  $seeded
     */
    public function correct(array $seeded): int
    {
        $changed = 0;

        foreach ($seeded as $key => ['section' => $section, 'hashes' => $hashes]) {
            foreach ($hashes as $locale => $hash) {
                $changed += DB::transaction(function () use ($key, $locale, $hash, $section): int {
                    $row = DB::table('sor_templates')->where('key', $key)->where('locale', $locale)->lockForUpdate()->first();

                    if ($row === null || ! hash_equals($hash, self::hash($row))) {
                        return 0;
                    }

                    DB::table('sor_templates')->where('id', $row->id)->update(['ground_section' => $section, 'updated_at' => now()]);

                    Audit::record('moderation.template_saved', null,
                        before: ['id' => $row->id, 'key' => $key, 'locale' => $locale, 'ground_document' => $row->ground_document, 'ground_section' => $row->ground_section],
                        after: ['id' => $row->id, 'key' => $key, 'locale' => $locale, 'ground_document' => $row->ground_document, 'ground_section' => $section],
                        reason: self::REASON);

                    return 1;
                });
            }
        }

        return $changed;
    }

    /**
     * The content a template was seeded with: action, label, facts, ground, document and section.
     */
    public static function hash(stdClass $row): string
    {
        return hash('sha256', (string) json_encode(
            [$row->action, $row->label, $row->facts, $row->ground, $row->ground_document, $row->ground_section],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        ));
    }

    /**
     * The old numbers were wrong; nothing to restore.
     */
    public function down(): void {}
};
