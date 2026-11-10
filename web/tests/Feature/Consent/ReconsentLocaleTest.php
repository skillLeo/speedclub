<?php

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\Content\Consents;
use Laravel\Sanctum\Sanctum;

/**
 * Code review phase-3-final MF-1: the version GET me/consents offers is the member's language only when that text was published at or
 * after the re-consent version, else the German (binding) text; POST me/consents accepts exactly that version, so accepting what
 * was offered always clears the re-consent and the member's writes work again (ADR-245).
 */
beforeEach(function () {
    $this->withoutDefer();

    foreach ([LegalDocumentKey::Terms, LegalDocumentKey::Privacy] as $key) {
        foreach (['de', 'en'] as $locale) {
            LegalDocument::factory()->create(['key' => $key, 'locale' => $locale, 'version' => '1', 'published_at' => now()->subMonth()]);
        }
    }

    $this->english = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'consented_at' => now()->subMonth(), 'locale' => 'en']);
    $this->german = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'consented_at' => now()->subMonth(), 'locale' => 'de']);
});

function rclPublish(string $locale, string $version, bool $reconsent, ?string $summary, int $minutesAgo): LegalDocument
{
    return LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Terms, 'locale' => $locale, 'version' => $version, 'requires_reconsent' => $reconsent,
        'summary' => $summary, 'body_md' => "# AGB $version ($locale)", 'published_at' => now()->subMinutes($minutesAgo),
    ]);
}

function rclAct(User $member): void
{
    app('auth')->forgetGuards();
    Sanctum::actingAs($member->fresh());
}

it('offers an English member the German text of a German-only re-consent, accepts it and lets them write again', function () {
    rclPublish('de', '2', true, 'Neue Regeln zu Fotos.', 5);
    rclAct($this->english);

    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/me/consents')->assertOk()
        ->assertJsonCount(1, 'data.required')
        ->assertJsonPath('data.required.0.key', 'terms')
        ->assertJsonPath('data.required.0.version', '2')
        ->assertJsonPath('data.required.0.summary', 'Neue Regeln zu Fotos.');
    $this->patchJson('/api/v1/me/settings', ['theme' => 'black'])->assertForbidden()->assertJsonPath('code', 'consent_required');

    // The English text the member already holds is not what is offered, so it cannot be "accepted" into a loop.
    $this->postJson('/api/v1/me/consents', ['terms_version' => '1'])->assertStatus(422)->assertJsonValidationErrors(['terms_version']);

    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk()->assertJsonPath('data.required', [])->assertJsonPath('data.accepted.terms', '2');

    expect(app(Consents::class)->outstanding($this->english->fresh()))->toBeFalse();
    rclAct($this->english);
    $this->patchJson('/api/v1/me/settings', ['theme' => 'black'])->assertOk();
});

it('reads the offered German version for an English request when the app asks for that version', function () {
    rclPublish('de', '2', true, 'Neue Regeln zu Fotos.', 5);

    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/legal/terms?version=2')->assertOk()
        ->assertJsonPath('data.version', '2')
        ->assertJsonPath('data.locale', 'de');
});

it('offers the member\'s own language once its text is at or after the re-consent version', function () {
    rclPublish('de', '2', true, 'Neue Regeln zu Fotos.', 5);
    rclPublish('en', '2', false, 'New rules on photos.', 4);
    rclAct($this->english);

    $this->getJson('/api/v1/me/consents')->assertOk()
        ->assertJsonPath('data.required.0.version', '2')
        ->assertJsonPath('data.required.0.summary', 'New rules on photos.');
    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk()->assertJsonPath('data.required', []);
});

it('offers a newer own-language version published after the re-consent one, and it clears the re-consent', function () {
    rclPublish('de', '2', true, 'Neue Regeln zu Fotos.', 5);
    rclPublish('en', '2.1', false, null, 2);
    rclAct($this->english);

    $this->getJson('/api/v1/me/consents')->assertOk()->assertJsonPath('data.required.0.version', '2.1');
    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertStatus(422);
    $this->postJson('/api/v1/me/consents', ['terms_version' => '2.1'])->assertOk()->assertJsonPath('data.required', []);
    expect(app(Consents::class)->outstanding($this->english->fresh()))->toBeFalse();
});

it('keeps a German member on the German text, and offers a re-consent published only in English in English', function () {
    rclPublish('de', '2', true, 'Neue Regeln zu Fotos.', 5);
    expect(app(Consents::class)->offeredVersion($this->german, LegalDocumentKey::Terms))->toBe('2');

    // A later re-consent text written in English only: German readers have nothing at or after it but the English text.
    rclPublish('en', '3', true, 'Photo rules, again.', 1);
    expect(app(Consents::class)->state($this->german->fresh())['required'][0])->toMatchArray(['version' => '3', 'summary' => 'Photo rules, again.']);

    rclAct($this->german);
    $this->postJson('/api/v1/me/consents', ['terms_version' => '3'])->assertOk()->assertJsonPath('data.required', []);
});

it('never leaves a member required after accepting what was offered (each locale, each order of publishing)', function (array $steps) {
    foreach ($steps as $i => [$locale, $version, $reconsent]) {
        rclPublish($locale, $version, $reconsent, null, 10 - $i);
    }

    foreach ([$this->english, $this->german, User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'locale' => 'fr'])] as $member) {
        $state = app(Consents::class)->state($member->fresh());
        $offered = collect($state['required'])->firstWhere('key', 'terms');
        expect($offered)->not->toBeNull();

        rclAct($member);
        $this->postJson('/api/v1/me/consents', ['terms_version' => $offered['version']])->assertOk()->assertJsonPath('data.required', []);
        expect(app(Consents::class)->outstanding($member->fresh()))->toBeFalse();
    }
})->with([
    'German re-consent only' => [[['de', '2', true]]],
    'English re-consent only' => [[['en', '2', true]]],
    'German re-consent, English follows' => [[['de', '2', true], ['en', '2', false]]],
    'English first, German re-consent after' => [[['en', '2', false], ['de', '2', true]]],
    'two German re-consents, English one behind' => [[['de', '2', true], ['en', '2', false], ['de', '3', true]]],
]);
