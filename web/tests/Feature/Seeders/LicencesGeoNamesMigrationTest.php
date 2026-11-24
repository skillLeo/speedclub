<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\AppConfig\LegalDocuments;
use Database\Seeders\LegalDocumentSeeder;

/**
 * M5.9b part 2 (ADR-508): the GeoNames place data (CC BY 4.0) is credited on the licences page (SET-17, /lizenzen). A fresh host gets it
 * from the seeder; a host seeded before gets a new licences version through a data migration that keeps everything staff wrote and asks
 * nobody to accept anything.
 */
function geonamesMigration(): object
{
    return require database_path('migrations/2026_12_16_120000_publish_licences_with_geonames.php');
}

function geonamesFileBody(string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/licenses.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

/** The licences text as the data file had it before M5.9b part 2: without the data section. */
function geonamesBefore(string $locale): string
{
    $section = geonamesMigration()::SECTIONS[$locale]['section'];

    return str_replace($section, '', geonamesFileBody($locale));
}

it('names GeoNames and CC BY 4.0 in the German and the English licences draft', function () {
    expect(geonamesFileBody('de'))->toContain('Ortsdaten: GeoNames ([geonames.org](https://www.geonames.org/)), CC BY 4.0')
        ->and(geonamesFileBody('en'))->toContain('Place data: GeoNames ([geonames.org](https://www.geonames.org/)), CC BY 4.0');

    foreach (['de', 'en'] as $locale) {
        expect(geonamesFileBody($locale))->toContain(geonamesMigration()::SECTIONS[$locale]['section']);
    }
});

it('publishes the attribution over an older licences text: the seeder\'s text, no re-consent, audited', function () {
    foreach (['de', 'en'] as $locale) {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Licenses, 'locale' => $locale, 'version' => LegalDocumentSeeder::VERSION, 'body_md' => geonamesBefore($locale)]);
    }

    geonamesMigration()->up();

    foreach (['de', 'en'] as $locale) {
        $current = app(LegalDocuments::class)->current(LegalDocumentKey::Licenses, $locale);
        $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

        expect($row->version)->toBe('2')
            ->and($row->body_md)->toBe(geonamesFileBody($locale))
            ->and($row->requires_reconsent)->toBeFalse()
            ->and($row->reason)->toContain('GeoNames')
            ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
                ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue();
    }

    expect(app(LegalDocuments::class)->needsReconsent(LegalDocumentKey::Licenses, '1'))->toBeFalse();
});

it('keeps a text staff reworded and appends the section; runs twice without a second version', function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Licenses, 'locale' => 'de', 'version' => '1', 'body_md' => "# Lizenzen\n\nEigener Text aus ADM-31.\n"]);

    geonamesMigration()->up();
    geonamesMigration()->up();

    $rows = LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->where('locale', 'de')->orderBy('id')->get();
    expect($rows)->toHaveCount(2)
        ->and($rows[1]->body_md)->toStartWith("# Lizenzen\n\nEigener Text aus ADM-31.\n\n## Daten")
        ->toContain('GeoNames');
});

it('leaves a fresh host to the seeder', function () {
    geonamesMigration()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->count())->toBe(0);
});
