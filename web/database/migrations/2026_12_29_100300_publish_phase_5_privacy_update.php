<?php

use App\Enums\ContentEvent;
use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;
use App\Services\Audit\Audit;
use Database\Seeders\Concerns\LegalDraftRepair;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * BL-21 / review M5.6–M5.7 SF-7: the one publish of the Phase 5 privacy changes after the gift texts — the Shop (M5.5, ADR-524: the
 * Shopify store opens only on a tap, no data and no tracking parameters passed), Treffen (M5.6: gallery after the meet, check-in without a
 * location, the weekly nearby meets), "Aufrufe und Statistiken", build reminders and the weekly recap (M5.7, 10 §6.1 "document the
 * counting in the Datenschutzerklärung") and the Forum (M5.8, ADR-526 incl. D8). Change list for the lawyer: docs/legal/phase-5-changes.md
 * §8–§9. As 2026_12_21_100000: every locale whose current privacy text is still a draft the seeder once shipped (SEEDED: every earlier body,
 * the two M5.9f bodies that migration may have published included) gets a new published version with the text of the data file; a text
 * staff changed in ADM-31 matches no hash and is left for ADM-31. AGB and Community-Richtlinien did not change and are not listed.
 *
 * No re-consent (unreviewed drafts, no members in production yet, OA-10; ADR-236 f, ADR-245): requires_reconsent stays off. Published by the
 * system and audited as `legal.published`. Running it again finds the new text and changes nothing; a fresh install gets the new text from
 * the seeder as version 1. The insights counting goes live with this text (SF-7: the flag `insights` is on everywhere).
 */
return new class extends Migration
{
    /** @var array<string, array<string, list<string>>> per locale: SHA-256 of every privacy body the seeder shipped before this update. */
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
                // Phase 5 gift texts (M5.9f, 2026_12_21_100000): aaa2adf9 and the gift-gate fix fe175279.
                '0bb53dc5ae9731bb54585527795ae0ffc4d33267086f09b07179dceb4e54cacc',
                '209fc7cbbff22eefe20aafada4c017d27bbf2098ac5af0bca24f6e045afa7345',
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
                // Phase 5 gift texts (M5.9f, 2026_12_21_100000): aaa2adf9 and the gift-gate fix fe175279.
                '817a3022b112e1558bbea032fce2b4768ad6c9b41dd7aa6fc330266af8437b58',
                '9fc195edf09054533449580d97f205ac944ae02d2f7bd11b2be921a06b36826e',
            ],
        ],
    ];

    public const REASON = 'Shop, Treffen in der Nähe, Aufrufe und Statistiken, Wochenrückblick und Forum ergänzt. Entwurf, rechtliche Prüfung ausstehend; keine erneute Zustimmung.';

    /** The audit reason of an open draft this migration moves onto the new text. */
    public const DRAFT_REASON = 'Entwurf auf die neu veröffentlichte Fassung umgestellt, damit er keine Abschnitte entfernt.';

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
                $count = $this->publish(LegalDocumentKey::from($key), $locale, $hashes);
                $published += $count;

                // DQ-P5-101: an open draft of the same document is now older than the live text; publishing it later would drop
                // what this version adds. One without text of its own moves onto the new text; one with staff text stays, marked stale.
                if ($count > 0) {
                    LegalDraftRepair::rebaseStale(LegalDocumentKey::from($key), $locale, self::DRAFT_REASON);
                }
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
