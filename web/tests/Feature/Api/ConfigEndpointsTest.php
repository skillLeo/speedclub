<?php

use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\LegalDocument;
use App\Services\AppConfig\AppConfig;

function publishConfig(string $key, array $payload, int $version = 1, ConfigVersionStatus $status = ConfigVersionStatus::Published): void
{
    ConfigVersion::factory()->create(['key' => $key, 'version' => $version, 'status' => $status, 'payload' => $payload]);
    app(AppConfig::class)->flush();
}

describe('GET app-config', function () {
    it('answers guests with defaults and the exact shape', function () {
        $this->getJson('/api/v1/app-config')
            ->assertOk()
            ->assertExactJsonStructure(['data' => [
                'min_version' => ['ios', 'android'],
                'latest_version' => ['ios', 'android'],
                // M3.5 ADM-37.
                'force_update_message',
                'maintenance' => ['enabled', 'message'],
                'flags',
                // M3.5 ADM-28: the logo set (with each logo's intrinsic size), the heroes with focal point and the OG default.
                'branding' => ['logo', 'splash_image', 'welcome_hero', 'accent_set', 'default_theme', 'logos' => ['wordmark_white', 'wordmark_black', 'square', 'app_mark'], 'logo_sizes' => ['wordmark_white', 'wordmark_black', 'square', 'app_mark'], 'heroes' => ['welcome', 'landing', 'splash'], 'og_default'],
                'announcements',
                'legal_versions' => ['imprint', 'privacy', 'terms', 'community', 'licenses'],
                // M3.5 ADM-31: the versions that ask members to accept again.
                'legal_reconsent' => ['terms', 'privacy'],
                'links' => ['imprint', 'privacy', 'terms', 'community', 'help', 'support_email', 'store_ios', 'store_android', 'get_app', 'sticker_shop'],
                // M2.4: Pusher's public values, or enabled false.
                'realtime' => ['enabled', 'key', 'cluster'],
            ]])
            ->assertJsonPath('data.maintenance.enabled', false)
            ->assertJsonPath('data.branding.default_theme', 'carbon')
            ->assertJsonPath('data.branding.logo', url('/brand/logo-wide-white-640.webp'))
            ->assertJsonPath('data.links.imprint', url('/impressum'))
            ->assertJsonPath('data.links.community', url('/community-richtlinien'));
    });

    it('never force-updates a 0.1.x build with the fallback values', function (string $platform) {
        $response = $this->getJson('/api/v1/app-config')->assertOk();

        foreach (['0.1.0', '0.1.1', '0.1.99'] as $build) {
            expect(version_compare($build, $response->json("data.min_version.$platform"), '>='))->toBeTrue($build);
        }

        expect(version_compare('0.1.0', $response->json("data.latest_version.$platform"), '>='))->toBeTrue();
    })->with(['ios', 'android']);

    it('keeps flags a JSON object when there are none', function () {
        expect($this->getJson('/api/v1/app-config')->getContent())->toContain('"flags":{}');
    });

    it('never caches the host of one request for the next client', function () {
        $this->getJson('http://evil.test/api/v1/app-config')
            ->assertJsonPath('data.links.imprint', 'http://evil.test/impressum');

        $this->getJson('http://speedclub.test/api/v1/app-config')
            ->assertJsonPath('data.links.imprint', 'http://speedclub.test/impressum')
            ->assertJsonPath('data.branding.logo', 'http://speedclub.test/brand/logo-wide-white-640.webp');
    });

    it('answers 304 when the ETag still matches and 200 after a change', function () {
        $first = $this->getJson('/api/v1/app-config')->assertOk()->assertHeader('ETag');
        $etag = $first->headers->get('ETag');

        $this->withHeader('If-None-Match', $etag)->getJson('/api/v1/app-config')->assertStatus(304);

        publishConfig('branding', ['accent_set' => 'winter']);

        $this->withHeader('If-None-Match', $etag)
            ->getJson('/api/v1/app-config')
            ->assertOk()
            ->assertJsonPath('data.branding.accent_set', 'winter');
    });

    it('reads the newest published version per key and ignores drafts', function () {
        publishConfig('remote_config', ['min_version' => ['ios' => '1.2.0'], 'latest_version' => ['android' => '1.9.0']], 1);
        publishConfig('remote_config', ['min_version' => ['ios' => '1.3.0']], 2);
        publishConfig('remote_config', ['min_version' => ['ios' => '9.9.9']], 3, ConfigVersionStatus::Draft);
        publishConfig('remote_config', ['min_version' => ['ios' => '0.0.1']], 4, ConfigVersionStatus::Superseded);

        $this->getJson('/api/v1/app-config')
            ->assertJsonPath('data.min_version', ['ios' => '1.3.0', 'android' => '0.1.0'])
            ->assertJsonPath('data.latest_version.android', '0.1.0');
    });

    it('localises the maintenance message', function (string $locale, string $message) {
        publishConfig('remote_config', ['maintenance' => ['enabled' => true, 'message' => ['de' => 'Wartung', 'en' => 'Maintenance']]]);

        $this->withHeader('Accept-Language', $locale)
            ->getJson('/api/v1/app-config')
            ->assertJsonPath('data.maintenance.enabled', true)
            ->assertJsonPath('data.maintenance.message', $message);
    })->with([['de', 'Wartung'], ['en', 'Maintenance']]);

    it('ignores unusable published values', function () {
        publishConfig('branding', ['default_theme' => 'neon', 'logo' => 42]);

        $this->getJson('/api/v1/app-config')
            ->assertJsonPath('data.branding.default_theme', 'carbon')
            ->assertJsonPath('data.branding.logo', null);
    });

    it('returns only public flags and treats partial rollouts as off', function () {
        FeatureFlag::factory()->create(['key' => 'sig.on', 'enabled' => true]);
        FeatureFlag::factory()->create(['key' => 'sig.off', 'enabled' => false]);
        FeatureFlag::factory()->create(['key' => 'sig.staff', 'enabled' => true, 'rules' => ['staff_only' => true]]);
        FeatureFlag::factory()->create(['key' => 'sig.hidden', 'enabled' => true, 'rules' => ['public' => false]]);
        FeatureFlag::factory()->create(['key' => 'sig.half', 'enabled' => true, 'rules' => ['percentage' => 50]]);

        $this->getJson('/api/v1/app-config')
            ->assertJsonPath('data.flags', ['sig.half' => false, 'sig.off' => false, 'sig.on' => true]);
    });

    it('shows current announcements only, in the language of the request', function () {
        publishConfig('announcements', ['items' => [
            ['id' => 'now', 'title' => ['de' => 'Hallo', 'en' => 'Hello'], 'body' => ['de' => 'Text', 'en' => 'Copy']],
            ['id' => 'later', 'title' => 'x', 'starts_at' => now()->addDay()->toIso8601String()],
            ['id' => 'over', 'title' => 'x', 'ends_at' => now()->subDay()->toIso8601String()],
            ['id' => 'broken', 'title' => 'x', 'ends_at' => 'not a date'],
            'not an item',
            ['title' => 'no id'],
        ]]);

        $this->withHeader('Accept-Language', 'en')
            ->getJson('/api/v1/app-config')
            ->assertJsonPath('data.announcements', [
                // M3.5 ADM-30 fields default for an item that predates them.
                ['id' => 'now', 'title' => 'Hello', 'body' => 'Copy', 'severity' => 'info', 'link' => null, 'cta_label' => null, 'audience' => 'all', 'dismissible' => true, 'starts_at' => null, 'ends_at' => null],
            ]);
    });

    it('lists the published legal versions', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2026-01', 'published_at' => now()->subDay()]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '2026-02', 'published_at' => null]);

        $this->getJson('/api/v1/app-config')
            ->assertJsonPath('data.legal_versions.privacy', '2026-01')
            ->assertJsonPath('data.legal_versions.terms', null);
    });
});

describe('GET legal', function () {
    it('lists the newest published version of each document, without the text, in the language of the request', function (string $locale, string $title, string $documentLocale) {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDays(2)]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'published_at' => now()->subDay()]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '9', 'published_at' => null]);

        $this->withHeader('Accept-Language', $locale)
            ->getJson('/api/v1/legal')
            ->assertOk()
            ->assertHeader('ETag')
            ->assertJsonCount(1, 'data')
            ->assertExactJsonStructure(['data' => [['key', 'title', 'locale', 'version', 'published_at']]])
            ->assertJsonPath('data.0.key', 'privacy')
            ->assertJsonPath('data.0.title', $title)
            ->assertJsonPath('data.0.locale', $documentLocale)
            ->assertJsonPath('data.0.version', '2');
    })->with([['de', 'Datenschutz', 'de'], ['en', 'Privacy policy', 'de']]);

    it('holds every document of SET-17 after seeding', function () {
        $this->seed(LegalDocumentSeeder::class);

        $keys = $this->getJson('/api/v1/legal')->assertOk()->json('data.*.key');

        expect($keys)->toEqualCanonicalizing(['imprint', 'privacy', 'terms', 'community', 'licenses']);
    });

    it('needs no sign-in', function () {
        $this->getJson('/api/v1/legal')->assertOk();
    });
});

describe('GET legal/{key}', function () {
    it('serves the newest published text in the language of the request', function (string $locale, string $body) {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '1', 'body_md' => '# Alt', 'published_at' => now()->subDays(2)]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '2', 'body_md' => '# Datenschutz', 'published_at' => now()->subDay()]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'en', 'version' => '2', 'body_md' => '# Privacy', 'published_at' => now()->subDay()]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '3', 'body_md' => '# Entwurf', 'published_at' => null]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '4', 'body_md' => '# Zukunft', 'published_at' => now()->addDay()]);

        $this->withHeader('Accept-Language', $locale)
            ->getJson('/api/v1/legal/privacy')
            ->assertOk()
            ->assertHeader('ETag')
            ->assertExactJsonStructure(['data' => ['key', 'title', 'locale', 'version', 'body_md', 'published_at']])
            ->assertJsonPath('data.key', 'privacy')
            ->assertJsonPath('data.locale', $locale)
            ->assertJsonPath('data.version', '2')
            ->assertJsonPath('data.body_md', $body);
    })->with([['de', '# Datenschutz'], ['en', '# Privacy']]);

    it('serves Markdown as stored and leaves rendering to the client', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'body_md' => "**fett**\n<script>x</script>", 'published_at' => now()->subDay()]);

        $this->getJson('/api/v1/legal/terms')->assertJsonPath('data.body_md', "**fett**\n<script>x</script>");
    });

    it('falls back to German when there is no translation', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay()]);

        $this->withHeader('Accept-Language', 'en')
            ->getJson('/api/v1/legal/imprint')
            ->assertOk()
            ->assertJsonPath('data.locale', 'de');
    });

    it('serves an older version on request', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDays(2)]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '2', 'published_at' => now()->subDay()]);

        $this->getJson('/api/v1/legal/terms?version=1')->assertOk()->assertJsonPath('data.version', '1');
        $this->getJson('/api/v1/legal/terms?version=9')->assertNotFound();
    });

    it('never serves a draft, not even by version', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => null]);

        $this->getJson('/api/v1/legal/terms')->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->getJson('/api/v1/legal/terms?version=1')->assertNotFound();
    });

    it('answers 404 for an unknown key', function () {
        $this->getJson('/api/v1/legal/nope')->assertNotFound()->assertJsonPath('code', 'not_found');
    });

    it('validates the version', function () {
        $this->getJson('/api/v1/legal/terms?version='.str_repeat('x', 33))->assertUnprocessable();
    });

    it('answers 304 for an unchanged text', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subDay()]);

        $etag = $this->getJson('/api/v1/legal/terms')->headers->get('ETag');

        $this->withHeader('If-None-Match', $etag)->getJson('/api/v1/legal/terms')->assertStatus(304);
    });
});
