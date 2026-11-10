<?php

use App\Actions\Admin\Settings\UpdateOrgSettings;
use App\Enums\LegalDocumentKey;
use App\Mail\SupportAddress;
use App\Models\LegalDocument;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Team/TeamHelpers.php';

function m36Org(array $values = []): array
{
    return [
        'company_name' => 'Speed Club GmbH', 'legal_form' => null, 'street' => 'Hafenstraße 12', 'postal_city' => '20457 Hamburg',
        'representative' => 'Lena Weber', 'contact_email' => 'kontakt@speedclub.de', 'support_email' => 'hilfe@speedclub.de',
        'vat_id' => 'DE123456789', 'register_court' => 'Amtsgericht Hamburg', 'register_number' => 'HRB 123456', 'default_locale' => 'de',
        ...$values,
    ];
}

it('lets only an Owner change the org settings', function (string $role, bool $allowed) {
    $run = fn () => app(UpdateOrgSettings::class)->handle(m31Staff($role), m36Org(), m36Reason());

    $allowed ? expect($run()->version)->toBe(1) : expect($run)->toThrow(AuthorizationException::class);
})->with([
    'owner' => ['owner', true], 'admin' => ['admin', false], 'moderator' => ['moderator', false], 'support' => ['support', false],
    'content_editor' => ['content_editor', false], 'analyst' => ['analyst', false],
]);

it('validates the org fields', function (array $values) {
    expect(fn () => app(UpdateOrgSettings::class)->handle(m31Staff('owner'), m36Org($values), m36Reason()))->toThrow(ValidationException::class);
})->with([
    'bad e-mail' => [['support_email' => 'keine-adresse']],
    'bad VAT ID' => [['vat_id' => '123']],
    'unknown locale' => [['default_locale' => 'fr']],
    'unknown field' => [['ceo_shoe_size' => '44']],
]);

it('resolves the legal placeholders from the published org, escaped, and leaves missing ones visible', function () {
    LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay(),
        'body_md' => "[[Firmenname]] [[Rechtsform]]\n[[Anschrift]], [[PLZ und Ort]]\nUSt-IdNr.: [[USt-IdNr.]]\n[[Hinweis nach § 36 VSBG, wird bei der anwaltlichen Prüfung festgelegt]]",
    ]);

    app(UpdateOrgSettings::class)->handle(m31Staff('owner'), m36Org(['company_name' => 'Speed *Club* GmbH']), m36Reason());
    $body = app(LegalDocuments::class)->current(LegalDocumentKey::Imprint, 'de')->body_md;

    expect($body)->toContain('Speed \*Club\* GmbH [[Rechtsform]]')
        ->and($body)->toContain('Hafenstraße 12, 20457 Hamburg')
        ->and($body)->toContain('DE123456789')
        ->and($body)->toContain('[[Hinweis nach § 36 VSBG')
        // The stored text keeps its placeholders.
        ->and(LegalDocument::query()->sole()->body_md)->toContain('[[Firmenname]]');

    $this->get('/impressum')->assertOk()->assertSee('Hafenstraße 12', false)->assertDontSee('[[Anschrift]]', false);
});

it('names the org support address in mails once it is set', function () {
    $before = SupportAddress::get();
    app(UpdateOrgSettings::class)->handle(m31Staff('owner'), m36Org(), m36Reason());

    expect($before)->not->toBe('hilfe@speedclub.de')
        ->and(SupportAddress::get())->toBe('hilfe@speedclub.de')
        ->and(app(OrgIdentity::class)->defaultLocale())->toBe('de');
});
