<?php

use App\Models\ConfigVersion;
use App\Models\User;
use App\Services\Notifications\NotificationTexts;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Support\Facades\DB;

/**
 * ADR-239: the org's default locale (ADM-52) is the platform fallback where nothing else says which language: the API and the public
 * pages without a matching Accept-Language, and mails and pushes to a member without a locale.
 */
function m36OrgLocale(string $locale): void
{
    ConfigVersion::factory()->create(['key' => 'org', 'status' => 'published', 'version' => 1, 'payload' => ['default_locale' => $locale]]);
    OrgIdentity::forget();
}

it('falls back to German while the org sets nothing', function () {
    expect(app(OrgIdentity::class)->defaultLocale())->toBe('de')
        ->and(app(OrgIdentity::class)->localeOr(null))->toBe('de');

    $this->withHeaders(['Accept-Language' => 'fr'])->getJson('/api/v1/app-config')->assertHeader('Content-Language', 'de');
});

it('answers the API in the org default locale when the client asks for none we have', function () {
    m36OrgLocale('en');

    $this->withHeaders(['Accept-Language' => 'fr'])->getJson('/api/v1/app-config')->assertHeader('Content-Language', 'en');
    $this->withHeaders(['Accept-Language' => 'de'])->getJson('/api/v1/app-config')->assertHeader('Content-Language', 'de');
});

it('renders a public page in the org default locale without a matching browser language', function () {
    m36OrgLocale('en');

    $this->withHeaders(['Accept-Language' => 'fr'])->get('/')->assertHeader('Content-Language', 'en');
    $this->withHeaders(['Accept-Language' => 'de-DE'])->get('/')->assertHeader('Content-Language', 'de');
});

it('writes to a member without a locale in the org default locale', function () {
    m36OrgLocale('en');
    $member = User::factory()->make(['locale' => null]);

    expect(app(NotificationTexts::class)->locale($member))->toBe('en')
        ->and(app(NotificationTexts::class)->locale(User::factory()->make(['locale' => 'de'])))->toBe('de');
});

it('reads the org setting only when the header matches no locale (no lookup on the common request)', function () {
    m36OrgLocale('en');
    DB::enableQueryLog();
    $this->withHeaders(['Accept-Language' => 'de-DE,de;q=0.9'])->getJson('/api/v1/app-config');

    $orgReads = fn (): array => collect(DB::getQueryLog())->filter(fn (array $q): bool => str_contains($q['query'], 'config_versions') && in_array('org', $q['bindings'], true))->all();
    expect($orgReads())->toBe([]);

    DB::flushQueryLog();
    OrgIdentity::forget();
    $this->withHeaders(['Accept-Language' => 'fr'])->getJson('/api/v1/app-config');
    expect($orgReads())->not->toBe([]);
});
