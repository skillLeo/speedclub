<?php

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Models\User;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * r5 audit "name-hyphen-break" on the Blade pages: a hyphen beside a part of fewer than 3 letters or figures gets a word joiner (U+2060)
 * in what the page shows, as the app's joinShortCompounds does, and the head (tab title, search snippet, share card) keeps the plain text.
 */
describe('a short part of a compound on the public pages', function () {
    it('joins it in a legal document, its title and its table of contents, and nowhere in the head', function () {
        LegalDocument::factory()->published()->create([
            'key' => LegalDocumentKey::Imprint,
            'locale' => 'de',
            'body_md' => "# Impressum für E-Autos\n\n## Kontakt per E-Mail\n\nBehörden erreichen uns unter [[DSA-Kontakt-E-Mail]].\n\n## Zwei\n\nText.\n\n## Drei\n\nText.\n\n## Aero-Seitenschweller\n\nText.",
        ]);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();
        $head = substr($html, 0, (int) strpos($html, '</head>'));

        expect($html)->toContain("data-testid=\"WEB-08.title\">Impressum für E-\u{2060}Autos</h1>")
            ->toContain("Behörden erreichen uns unter [[DSA-\u{2060}Kontakt-\u{2060}E-\u{2060}Mail]].")
            ->toContain("Kontakt per E-\u{2060}Mail</a>")
            ->toContain('<h2 id="s4-aero-seitenschweller">Aero-Seitenschweller</h2>')
            ->and($head)->toContain('<title>Impressum für E-Autos · SPEED CLUB</title>')
            ->not->toContain("\u{2060}");
    });

    it('joins it in the running copy of a form page', function () {
        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/konto-loeschen')->assertOk()->getContent();

        expect($html)->toContain("Deine QR-\u{2060}Sticker zeigen ab sofort")
            ->toContain("über den Link aus der Export-\u{2060}E-\u{2060}Mail herunterladen.")
            ->toContain("E-\u{2060}Mail-Adresse</label>")
            ->and(substr($html, 0, (int) strpos($html, '</head>')))->not->toContain("\u{2060}");
    });

    it('joins it in the owner\'s description of a build, and nowhere in the head', function () {
        $owner = User::factory()->create(['username' => 'lukas.sc']);
        $vehicle = publishedVehicle($owner, ['description' => 'Bei einem RB-Spezialisten mit GT-SS-Ladern aufgebaut, dazu Aero-Seitenschweller.']);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/v/'.$vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->toContain("data-testid=\"VEH-01.description\">Bei einem RB-\u{2060}Spezialisten mit GT-\u{2060}SS-\u{2060}Ladern aufgebaut, dazu Aero-Seitenschweller.</p>")
            ->and(substr($html, 0, (int) strpos($html, '</head>')))->not->toContain("\u{2060}");
    });
});
