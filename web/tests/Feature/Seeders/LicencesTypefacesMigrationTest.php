<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\AppConfig\LegalDocuments;
use Database\Seeders\LegalDocumentSeeder;

/**
 * M4.1 code review SF-5 (ADR-402): a host seeded before M4.1 keeps licences v1, which names Barlow Semi Condensed. The data migration
 * publishes a new licences version with the 2.0 typefaces, without asking any member to accept anything.
 */
function licencesMigration(): object
{
    return require database_path('migrations/2026_11_25_100000_publish_licences_with_the_2_0_typefaces.php');
}

/** The member-facing text of database/data/legal/licenses.{locale}.md, as LegalDocumentSeeder stores it. */
function licencesFileBody(string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/licenses.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

/** The row of the retired v1 typeface in licences v1 (ADR-402), and that typeface's family name, read from the migration's own map. */
function retiredRow(string $locale): string
{
    return (string) array_key_last(licencesMigration()::ROWS[$locale]);
}

function retiredFamily(string $locale): string
{
    return trim(explode('(', explode('|', retiredRow($locale))[1])[0]);
}

/** Licences v1 as a host seeded before M4.1 holds it: the file text with the v1 font rows. */
function licencesV1(string $locale, ?string $body = null): LegalDocument
{
    return LegalDocument::factory()->published()->create([
        'key' => LegalDocumentKey::Licenses,
        'locale' => $locale,
        'version' => LegalDocumentSeeder::VERSION,
        'body_md' => $body ?? strtr(licencesFileBody($locale), array_flip(licencesMigration()::ROWS[$locale])),
    ]);
}

it('publishes a licences version with the 2.0 typefaces in every locale, the text the seeder gives a fresh host', function () {
    $v1 = ['de' => licencesV1('de'), 'en' => licencesV1('en')];
    expect(retiredFamily('de'))->toBe(retiredFamily('en'))->toEndWith('Semi Condensed')
        ->and($v1['de']->body_md)->toContain(retiredRow('de'))
        ->and($v1['en']->body_md)->toContain(retiredRow('en'));

    licencesMigration()->up();

    foreach (['de', 'en'] as $locale) {
        $current = app(LegalDocuments::class)->current(LegalDocumentKey::Licenses, $locale);
        $row = LegalDocument::query()->whereKey($current?->id)->firstOrFail();

        expect($row->version)->toBe('2')
            ->and($row->body_md)->toBe(licencesFileBody($locale))
            ->not->toContain(retiredFamily($locale))
            // The placeholders stay in the row, OrgIdentity fills them when it is read.
            ->toContain('[[Kontakt-E-Mail]]')
            ->and($row->requires_reconsent)->toBeFalse()
            ->and($row->summary)->toBeNull()
            ->and($row->published_at)->not->toBeNull()
            ->and($row->reason)->toContain('ADR-402')
            ->and($v1[$locale]->fresh()?->body_md)->toBe($v1[$locale]->body_md)
            ->and(AuditEvent::query()->where('action', 'legal.published')->where('target_id', (string) $row->id)
                ->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue();
    }

    // Informational: no re-consent version exists, so nobody is asked again, whatever they accepted.
    expect(app(LegalDocuments::class)->reconsentVersion(LegalDocumentKey::Licenses))->toBeNull()
        ->and(app(LegalDocuments::class)->needsReconsent(LegalDocumentKey::Licenses, '1'))->toBeFalse();
});

it('changes nothing when it runs again', function () {
    licencesV1('de');
    licencesMigration()->up();
    licencesMigration()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->pluck('version')->sort()->values()->all())->toBe(['1', '2'])
        ->and(AuditEvent::query()->where('action', 'legal.published')->count())->toBe(1);
});

it('keeps what staff wrote elsewhere in the text and exchanges only the two font rows', function () {
    $edited = strtr(licencesFileBody('de'), array_flip(licencesMigration()::ROWS['de']))."\nNachtrag aus ADM-31.\n";
    licencesV1('de', $edited);

    licencesMigration()->up();

    expect(app(LegalDocuments::class)->current(LegalDocumentKey::Licenses, 'de')?->body_md)
        ->toContain('Nachtrag aus ADM-31.')
        ->toContain('| Archivo (Schriftart) | SIL Open Font License 1.1 |')
        ->toContain('| Inter und Inter Display (Schriftarten) | SIL Open Font License 1.1 |')
        ->not->toContain(retiredFamily('de'));
});

it('leaves a text whose retired typeface row staff reworded to ADM-31', function () {
    licencesV1('de', "# Lizenzen\n\n| ".retiredFamily('de')." | OFL |\n");

    licencesMigration()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->count())->toBe(1);
});

it('does nothing on a fresh host, where the seeder writes the 2.0 text as version 1', function () {
    licencesMigration()->up();
    expect(LegalDocument::query()->count())->toBe(0);

    $this->seed(LegalDocumentSeeder::class);

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Licenses)->pluck('body_md')->all())
        ->toBe([licencesFileBody('de'), licencesFileBody('en')]);
});

it('takes the next free version when a draft already holds the next number, and leaves the draft alone', function () {
    licencesV1('de');
    $draft = LegalDocument::factory()->create(['key' => LegalDocumentKey::Licenses, 'locale' => 'de', 'version' => '2', 'body_md' => "# Lizenzen\n\nEntwurf aus ADM-31."]);

    licencesMigration()->up();

    expect(app(LegalDocuments::class)->current(LegalDocumentKey::Licenses, 'de')?->version)->toBe('3')
        ->and($draft->fresh()?->published_at)->toBeNull()
        ->and($draft->fresh()?->body_md)->toBe("# Lizenzen\n\nEntwurf aus ADM-31.");
});
