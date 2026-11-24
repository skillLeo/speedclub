<?php

use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * M5.9f gift gate (10 §16, OA-35): the Datenschutzerklärung, AGB and Community-Richtlinien drafts now describe the SPEED CLUB 2.1 gift
 * features as the code runs them (plate blur, STREET DEX camera, location, spots and their abuse signal with the member-free install key
 * of ADR-511, XP, levels, badges, Founding Member, Car of the Day, invites, Build Score, Season Wrapped, their notifications, retention and
 * data export; change list for the lawyer: docs/legal/phase-5-changes.md). LegalDocumentSeeder never touches an existing row, so a host
 * seeded before M5.9f keeps the Phase 4 drafts. As in 2026_12_09_100000 (M4.18), every locale whose current text is still a draft the
 * seeder once shipped (SEEDED: SHA-256 of every earlier body of database/data/legal/{key}.{locale}.md, the Phase 4 bodies that migration
 * published included) gets a new published version with the text of the data file. A text staff changed in ADM-31 matches no hash and is
 * left for ADM-31. The imprint did not change and is not listed.
 *
 * No re-consent: 08_LEGAL_COMPLIANCE leaves that to the publish in ADM-31 (four-eyes, ADR-236 f), these are unreviewed drafts, and no
 * production host has members yet (OA-10). requires_reconsent stays off, so nobody is asked to accept anything and no write is refused
 * (ADR-245). Published by the system and audited as `legal.published`. Running it again finds the new text and changes nothing; a fresh
 * install has no rows yet and gets the new text from the seeder as version 1.
 */
return new class extends Migration
{
    /** @var array<string, array<string, list<string>>> per document and locale: SHA-256 of every body the seeder shipped before M5.9f. */
    public const SEEDED = [
        'privacy' => [
            'de' => [
                'd660963b3cc3c654c481d714ebf7c3ede745a3740e297604c5d2cb74dba5ae8e',
                '359e143d1808a4bc4dd5ef5c7358f0f839a2242d83407707435889c6e729a423',
                '9360ff6467dbefd3d8edf5351e9a5212a939ec3dece8525caa5787b5efa9f54e',
                '634ce78a4cc9da31b6540f8a639b516cad5b5ff49fb50001cd6aa62343fce0a2',
                '1c3e2589fd71bd513c848772fa3a5f3bcccbf50d8e36186b8cd43773aa0f5bf8',
                'e96ca4bcb5e928c7330532e585ade2c91730c237ff16ce24cb8046ffe4468d32',
                // Phase 4 (M4.18, 2026_12_09_100000).
                'e9739cec55d910fc79547e012b24f60bc54ea2e4714311a4fdf50ddbf0f466b6',
            ],
            'en' => [
                '2c628c8cd89d0cb58ac1a00e320c8e8ac1e0129f365c360021ca349daae398da',
                '88c65a7ef1d74b2c61b8e632e5c83eef55351cb65607936098509c731528373c',
                'ea54ec37698e5fc10d7d411951f5683b124dc953b19cced60c8491da1a76df19',
                '8e819ffe9dbdee56fd66cb00c5059d317b9b2623f3aa2bb5f6764444fa4a78b2',
                'e8bdb8fe513dcaeb405b336ea03f15f1282e79b4fdcd3e0900c7558222a0d85b',
                'fd310b28ab04e2de2ad858202d3339da09bacc09bc491ffd5a96504f9bc03fe2',
                // Phase 4 (M4.18, 2026_12_09_100000).
                '534aac4a2dddda8778c9567aec36f42b666cea7c41bac11115d729abbc70e0ad',
            ],
        ],
        'terms' => [
            'de' => [
                '407248d418bc23936c6204f52178bc72e71ccab53c6ac916e4a9c68e5abac2b4',
                'f3e4a672b9f7ea8a3bea230a4eedc05397ec1155d389a97441657f78e3d21638',
                'd6bd52287613ccc1ab4b42b96b945e708059aca539d68575a5beb0181538a854',
                // Phase 4 (M4.18, 2026_12_09_100000).
                '049d990a1f3a6f8294bdf8700eec753d8c601d5a65cb851f263bc34fdde1e589',
            ],
            'en' => [
                'af77b4e25b564e2c554b5ddad151e357a845c5f14a82876fa859984a5fe6c485',
                '9eb51f23c7e4d053a63c20d912ef60e568f303f865cc299f413f4cc89fb1c32d',
                '396b466efea9ce7ad70e8cef71fdca91bb38527ad7206c9f15c57b2da39fa8a1',
                // Phase 4 (M4.18, 2026_12_09_100000).
                '5128a030cf5103629b36328545bea61c88d5107445e6988680b30795dbc68abc',
            ],
        ],
        'community' => [
            'de' => [
                'beecbf6053710976a35cd28fdde1d9eb3ac29d3b9cd7ce02de0b784929e28807',
                'd68d6d440e9c7ba8333500c1e72b3fe8ed873558de46b8b7eb9fafcce632b01d',
                // Phase 4 (M4.18, 2026_12_09_100000).
                'cadd9758d7e9ec773215172d955166651f17183c9d2082ce9bf72dd26dd61b63',
            ],
            'en' => [
                '401551910ccdd72b18e7a279b1fbabb7c1c4e6595f646b02f9d6088275f19290',
                'ef6f6cc195ab5b627baae1ad9387dcb1ddbb8b267822ea9599768c980afdc578',
                // Phase 4 (M4.18, 2026_12_09_100000).
                'c9559a141c533ba757dd3b225297ecea07b1f16edd0c54e7ca9f2369e58e1010',
            ],
        ],
    ];

    public const REASON = 'Neue Funktionen beschrieben: STREET DEX, Level und Abzeichen, Einladungen, Car of the Day, Build Score und Season Wrapped. Entwurf, rechtliche Prüfung ausstehend; keine erneute Zustimmung.';

    public function up(): void
    {
        $this->publishOver(self::SEEDED);
    }

    /**
     * Publishes the data file's text over every current text whose body hash is listed for its document and locale; returns how many
     * versions it published. up() passes SEEDED; tests pass the hash of a text they wrote.
     *
     * @param  array<string, array<string, list<string>>>  $seeded
     */
    public function publishOver(array $seeded): int
    {
        $published = 0;

        foreach ($seeded as $key => $locales) {
            foreach ($locales as $locale => $hashes) {
                $published += $this->publish(LegalDocumentKey::from($key), $locale, $hashes);
            }
        }

        // SET-17, the legal pages and app-config's legal_versions read the newest text; the cached copy would keep the old one.
        if ($published > 0) {
            app(AppConfig::class)->flush();
        }

        return $published;
    }

    /**
     * Published texts are history (a member may have read one); nothing is taken back.
     */
    public function down(): void {}

    /**
     * The member-facing text of the data file, as LegalDocumentSeeder stores it.
     */
    public static function fileBody(LegalDocumentKey $key, string $locale): string
    {
        $contents = (string) file_get_contents(database_path("data/legal/{$key->value}.$locale.md"));

        if (preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', $contents, $parts) !== 1) {
            throw new RuntimeException("Legal draft [{$key->value}.$locale] has no metadata block.");
        }

        return trim($parts[2])."\n";
    }

    /**
     * @param  list<string>  $hashes
     */
    private function publish(LegalDocumentKey $key, string $locale, array $hashes): int
    {
        $body = self::fileBody($key, $locale);

        return DB::transaction(function () use ($key, $locale, $hashes, $body): int {
            $versions = LegalDocument::query()->where('key', $key)->where('locale', $locale)->lockForUpdate()->get();
            // The raw stored text (LegalDocuments::current() would resolve the [[…]] placeholders, and those must stay in the row).
            $current = $versions
                ->filter(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at->lessThanOrEqualTo(now()))
                ->sortByDesc(fn (LegalDocument $row): string => $row->published_at?->format('Y-m-d H:i:s.u').sprintf('%020d', $row->id))
                ->first();

            if ($current === null || ! in_array(hash('sha256', $current->body_md), $hashes, true) || $current->body_md === $body) {
                return 0;
            }

            $version = $this->nextVersion($current->version, $versions->map(fn (LegalDocument $row): string => $row->version)->all());
            $document = LegalDocument::query()->create([
                'key' => $key,
                'locale' => $locale,
                'version' => $version,
                'body_md' => $body,
                'requires_reconsent' => false,
                'summary' => null,
                'published_at' => now(),
                'reason' => self::REASON,
            ]);

            Audit::record(ContentEvent::LegalPublished->value, $document,
                before: ['key' => $key->value, 'locale' => $locale, 'version' => $current->version],
                after: ['key' => $key->value, 'locale' => $locale, 'version' => $version, 'requires_reconsent' => false, 'summary' => null, 'body_sha256' => hash('sha256', $body)],
                reason: self::REASON);

            return 1;
        });
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
