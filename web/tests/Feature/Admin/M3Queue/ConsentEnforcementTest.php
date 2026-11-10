<?php

use App\Enums\LegalDocumentKey;
use App\Http\Middleware\EnsureCurrentConsent;
use App\Models\LegalDocument;
use App\Models\User;
use App\Services\Content\Consents;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

/**
 * ADR-245: while a member has not accepted the current re-consent version of AGB or Datenschutz, every member write answers 403
 * `consent_required`, except accepting, signing out, the GDPR rights, the support contact, the DSA rights and ending a view-as. Reads
 * stay open. The walk reads the router, so a member write route added later is covered without a change here.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->withoutDefer();
    Mail::fake();

    foreach ([LegalDocumentKey::Terms, LegalDocumentKey::Privacy] as $key) {
        LegalDocument::factory()->create(['key' => $key, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subMonth()]);
    }

    $this->member = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'consented_at' => now()->subMonth(), 'locale' => 'de']);
});

function m3qReconsent(string $version = '2', string $locale = 'de', ?string $summary = 'Neue Regeln zu Fotos und Moderation.'): LegalDocument
{
    return LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Terms, 'locale' => $locale, 'version' => $version, 'requires_reconsent' => true,
        'summary' => $summary, 'published_at' => now()->subMinute(),
    ]);
}

/** @return list<LaravelRoute> api/v1 routes behind the member group */
function m3qMemberRoutes(): array
{
    return array_values(array_filter(
        Route::getRoutes()->getRoutes(),
        fn (LaravelRoute $route): bool => str_starts_with($route->uri(), 'api/v1/') && in_array('member', $route->gatherMiddleware(), true),
    ));
}

/** The route's URI with a value for each parameter that its `where` pattern accepts. */
function m3qUri(LaravelRoute $route): string
{
    return '/'.preg_replace_callback('/\{([^}?]+)\??\}/', function (array $match) use ($route): string {
        $pattern = $route->wheres[$match[1]] ?? null;

        foreach (['01JAAAAAAAAAAAAAAAAAAAAAAA', '320', 'tobi.quattro', 'ABCD2345'] as $candidate) {
            if ($pattern === null || preg_match('#\A(?:'.$pattern.')\z#', $candidate) === 1) {
                return $candidate;
            }
        }

        return $match[1];
    }, $route->uri());
}

it('answers every member write with consent_required while a re-consent is outstanding, except the listed ones', function () {
    m3qReconsent();
    $checked = ['refused' => 0, 'exempt' => 0];

    foreach (m3qMemberRoutes() as $route) {
        foreach (array_diff($route->methods(), ['GET', 'HEAD']) as $method) {
            $this->app['auth']->forgetGuards();
            Sanctum::actingAs($this->member->fresh());
            $response = $this->json($method, m3qUri($route));
            $exempt = in_array($route->getName(), EnsureCurrentConsent::EXEMPT, true);

            if ($exempt) {
                $code = str_contains((string) $response->headers->get('Content-Type'), 'json') ? $response->json('code') : null;
                expect($code)->not->toBe('consent_required', "$method {$route->uri()} is exempt");
                $checked['exempt']++;

                continue;
            }

            expect($response->status())->toBe(403, "$method {$route->uri()} answered {$response->status()}")
                ->and($response->json('code'))->toBe('consent_required', "$method {$route->uri()}");
            $checked['refused']++;
        }
    }

    expect($checked['refused'])->toBeGreaterThan(50)
        // auth/logout is exempt too, but sits on plain auth:sanctum, outside the member group (ADR-137).
        ->and($checked['exempt'])->toBe(count(EnsureCurrentConsent::EXEMPT) - 1);
});

it('names only exempt routes that exist and are member writes', function () {
    $writes = collect(m3qMemberRoutes())->filter(fn (LaravelRoute $route): bool => array_diff($route->methods(), ['GET', 'HEAD']) !== [])->map->getName()->all();
    $logout = Route::getRoutes()->getByName('api.v1.auth.logout');

    foreach (EnsureCurrentConsent::EXEMPT as $name) {
        expect(in_array($name, $writes, true) || $name === $logout?->getName())->toBeTrue($name);
    }
});

it('keeps reads open and lets the member accept, after which writes work again', function () {
    m3qReconsent();
    Sanctum::actingAs($this->member);

    $this->getJson('/api/v1/me/consents')->assertOk()->assertJsonPath('data.required.0.version', '2');
    $this->getJson('/api/v1/auth/me')->assertOk();
    $this->patchJson('/api/v1/me/settings', ['theme' => 'black'])->assertForbidden()->assertJsonPath('code', 'consent_required')
        ->assertJsonPath('message', 'Wir haben die AGB oder die Datenschutzerklärung geändert. Bitte stimm zuerst zu, danach kannst du weitermachen.');

    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk()->assertJsonPath('data.required', []);
    // A real request reads the member again through the token; actingAs keeps the instance, so hand over the stored row.
    $this->app['auth']->forgetGuards();
    Sanctum::actingAs($this->member->fresh());

    expect($this->patchJson('/api/v1/me/settings', ['theme' => 'black'])->json('code'))->not->toBe('consent_required');
});

it('answers in English for an English request', function () {
    m3qReconsent();
    Sanctum::actingAs($this->member);

    $this->withHeader('Accept-Language', 'en')->patchJson('/api/v1/me/settings', ['theme' => 'black'])->assertForbidden()
        ->assertJsonPath('message', 'We have updated the terms or the privacy policy. Please accept them first, then you can carry on.');
});

it('refuses nothing while no re-consent version exists, or once the member holds the current one', function () {
    LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1a', 'requires_reconsent' => false, 'published_at' => now()->subDay()]);
    Sanctum::actingAs($this->member);
    expect($this->patchJson('/api/v1/me/settings', ['theme' => 'black'])->json('code'))->not->toBe('consent_required')
        ->and(app(Consents::class)->outstanding($this->member))->toBeFalse();

    m3qReconsent();
    $newcomer = User::factory()->create(['terms_version' => '2', 'privacy_version' => '1', 'locale' => 'de']);
    expect(app(Consents::class)->outstanding($newcomer))->toBeFalse()
        ->and(app(Consents::class)->outstanding($this->member->fresh()))->toBeTrue();
});

it('gives the summary in the member\'s language, German as the fallback', function () {
    // The German re-consent version, its English text with an English note, then a newer English text without a note.
    m3qReconsent('3', 'de', 'Neue Regeln zu Fotos.');
    LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'en', 'version' => '3', 'summary' => 'New rules on photos.', 'published_at' => now()->subSeconds(30)]);
    $this->travel(1)->seconds();
    $this->member->forceFill(['locale' => 'en'])->save();
    $french = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'locale' => 'fr']);

    expect(app(Consents::class)->state($this->member->fresh())['required'][0])->toMatchArray(['key' => 'terms', 'version' => '3', 'summary' => 'New rules on photos.'])
        ->and(app(Consents::class)->state($french)['required'][0]['summary'])->toBe('Neue Regeln zu Fotos.')
        ->and(Consents::locale($french))->toBe('de');

    LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'en', 'version' => '3.1', 'summary' => null, 'published_at' => now()]);
    expect(app(Consents::class)->state($this->member->fresh())['required'][0])->toMatchArray(['version' => '3.1', 'summary' => 'New rules on photos.']);
});
