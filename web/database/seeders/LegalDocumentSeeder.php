<?php

namespace Database\Seeders;

use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Models\ConfigVersion;
use App\Models\LegalDocument;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Version 1 of every legal text, in German and English, from database/data/legal/{key}.{locale}.md.
 *
 * Each file starts with a metadata block between --- lines that never reaches members. legal_documents has no metadata
 * column, so the review state goes into the config_versions row "legal_review": none of these texts has been reviewed
 * by a lawyer yet (08_LEGAL_COMPLIANCE.md), and the [[…]] placeholders still need the client's company data.
 *
 * Existing rows stay untouched: an edit in ADM-31 must survive running this again.
 */
class LegalDocumentSeeder extends Seeder
{
    use SeedsFromData;

    public const VERSION = '1';

    public const REVIEW_KEY = 'legal_review';

    public const LOCALES = ['de', 'en'];

    public function run(): void
    {
        $review = [];
        // Where the demo seed runs, its fixed clock: the legal pages then show a date before the QA clock and the same one
        // after every reseed. A real deploy dates the texts to the day it seeds them.
        $publishedAt = DemoSeeder::runsAutomatically() ? CarbonImmutable::parse(DemoSeeder::NOW) : now();

        foreach (LegalDocumentKey::cases() as $key) {
            foreach (self::LOCALES as $locale) {
                [$metadata, $body] = $this->read($key, $locale);

                LegalDocument::query()->firstOrCreate(
                    ['key' => $key, 'locale' => $locale, 'version' => self::VERSION],
                    ['body_md' => $body, 'published_at' => $publishedAt],
                );

                $review[$key->value][$locale] = $metadata;
            }
        }

        if (! ConfigVersion::query()->where('key', self::REVIEW_KEY)->exists()) {
            ConfigVersion::query()->create([
                'key' => self::REVIEW_KEY,
                'version' => 1,
                'status' => ConfigVersionStatus::Draft,
                'payload' => ['documents' => $review],
                'reason' => 'Entwürfe aus dem Seeder. Vor dem Start anwaltlich prüfen lassen.',
            ]);
        }
    }

    /**
     * @return array{0: array<string, string>, 1: string} metadata and member-facing Markdown
     */
    private function read(LegalDocumentKey $key, string $locale): array
    {
        $path = database_path("data/legal/{$key->value}.$locale.md");
        $contents = is_file($path) ? file_get_contents($path) : false;

        if ($contents === false || preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', $contents, $parts) !== 1) {
            throw new RuntimeException("Legal draft [$path] is missing or has no metadata block.");
        }

        $metadata = [];

        foreach (preg_split('/\R/', $parts[1]) ?: [] as $line) {
            [$name, $value] = array_pad(explode(':', $line, 2), 2, '');
            $metadata[trim($name)] = trim($value);
        }

        return [$metadata, trim($parts[2])."\n"];
    }
}
