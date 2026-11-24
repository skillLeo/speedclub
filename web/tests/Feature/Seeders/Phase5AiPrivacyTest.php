<?php

use App\Enums\AuditActorType;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\AppConfig\LegalDocuments;
use Database\Seeders\LegalDocumentSeeder;

/**
 * M5.9 AI helpers (m5.9-contract §6, lead D-3): the privacy text says what goes to the AI provider for the factory figures, the part match
 * and the forum summaries (public post text without names, mentions, links and photos; the legal basis left as a draft for the lawyer),
 * with the storage rows; and it reaches hosts that already ran 2026_12_29_100300 through 2026_12_31_200200 (no re-consent, audited,
 * idempotent).
 */
function p5AiPrivacy(): object
{
    return require database_path('migrations/2026_12_31_200200_publish_phase_5_ai_privacy.php');
}

function p5AiBody(string $locale): string
{
    preg_match('/\A---\R(.*?)\R---\R+(.*)\z/s', (string) file_get_contents(database_path("data/legal/privacy.$locale.md")), $parts);

    return trim($parts[2])."\n";
}

it('says what the new AI features send to the provider, in German and English', function (string $de, string $en) {
    // The storage rows quote the configured cache periods, so the text and the pruning cannot drift apart.
    $days = ['{spec}' => config()->integer('speedclub.ai.spec_cache_days'), '{norm}' => config()->integer('speedclub.ai.normalisation_cache_days')];

    expect(p5AiBody('de'))->toContain(strtr($de, $days))->and(p5AiBody('en'))->toContain(strtr($en, $days));
})->with([
    'catalogue names only' => ['An den KI-Anbieter gehen dafür nur die Namen aus unserem Katalog', 'Only the names from our catalogue (for example "BMW 3 Series E46") go to the AI provider'],
    'provenance label' => ['„Herstellerangabe (KI-Vorschlag)“', '"Manufacturer figure (AI suggestion)"'],
    'typed part only' => ['an den Anbieter gehen nur diese Eingabe und die Kategorie', 'only that text and the category go to the provider'],
    'forum text without names' => ['senden wir den Titel und den Text öffentlicher Beiträge an den KI-Anbieter, ohne Namen, Erwähnungen, Links und Fotos', 'we send the title and the text of public posts to the AI provider, without names, mentions, links and photos'],
    'forum label' => ['„KI-Zusammenfassung“', '"AI summary"'],
    'legal basis left for the lawyer' => ['[[Prüfen: Rechtsgrundlage und Information für Forenbeiträge', '[[Prüfen: Rechtsgrundlage und Information für Forenbeiträge'],
    'cache periods' => ['| KI-Herstellerangaben zu einem Modell (ohne Mitgliederdaten) | {spec} Tage |', '| AI manufacturer figures for a model (no member data) | {spec} days |'],
    'normalisation period' => ['| KI-Zuordnung einer Teile-Eingabe (ohne Bezug zu dir) | {norm} Tage |', '| AI matching of a typed part (no link to you) | {norm} days |'],
]);

it('knows every privacy body shipped before, the one 2026_12_29_100300 published included', function () {
    $previous = require database_path('migrations/2026_12_29_100300_publish_phase_5_privacy_update.php');

    foreach (['de', 'en'] as $locale) {
        $hashes = p5AiPrivacy()::SEEDED['privacy'][$locale];

        expect(array_diff($previous::SEEDED['privacy'][$locale], $hashes))->toBe([])
            ->and(count($hashes))->toBe(count($previous::SEEDED['privacy'][$locale]) + 1)
            ->and($hashes)->not->toContain(hash('sha256', p5AiBody($locale)));
    }
});

it('publishes over a seeded draft without asking anybody to accept again, once', function () {
    $old = "# Datenschutzerklärung\n\nPhase-5-Fassung.\n";
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '3', 'body_md' => $old]);

    expect(p5AiPrivacy()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(1);

    $row = app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'de');
    expect($row?->body_md)->toBe(p5AiBody('de'))
        ->and($row?->version)->toBe('4')
        ->and($row?->requires_reconsent)->toBeFalse()
        ->and(AuditEvent::query()->where('action', 'legal.published')->where('actor_type', AuditActorType::System->value)->exists())->toBeTrue()
        ->and(p5AiPrivacy()->publishOver(['privacy' => ['de' => [hash('sha256', $old)]]]))->toBe(0);
});

it('does nothing on a fresh host or over a text staff changed', function () {
    p5AiPrivacy()->up();
    expect(LegalDocument::query()->count())->toBe(0);

    $this->seed(LegalDocumentSeeder::class);
    LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->where('locale', 'en')->update(['body_md' => "# Privacy\n\nEdited.\n"]);
    p5AiPrivacy()->up();

    expect(LegalDocument::query()->where('key', LegalDocumentKey::Privacy)->count())->toBe(2)
        ->and(app(LegalDocuments::class)->current(LegalDocumentKey::Privacy, 'en')?->body_md)->toBe("# Privacy\n\nEdited.\n");
});
