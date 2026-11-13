<?php

use App\Enums\MediaStatus;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\User;
use Database\Seeders\FeatureFlagSeeder;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

beforeEach(fn () => $this->withHeader('Accept-Language', 'de'));

/**
 * M2.7 system and web pages (m2.7-contract §2): app-config links, WEB-04 /app-laden, WEB-07 /email/{action}, the legal-status flag (ADR-153
 * lifted) and failed mod photos (ADR-181 revisit).
 */
describe('app-config links (SYS-01, DQ-081)', function () {
    it('names the get-the-app page, and the store links once they are configured', function () {
        $this->getJson('/api/v1/app-config')->assertOk()
            ->assertJsonPath('data.links.get_app', url('/app-laden'))
            ->assertJsonPath('data.links.store_ios', null)
            ->assertJsonPath('data.links.store_android', null);

        config(['speedclub.app_config.links.store_android' => 'https://play.google.com/store/apps/details?id=de.speedclub.app']);
        cache()->flush();

        $this->getJson('/api/v1/app-config')->assertJsonPath('data.links.store_android', 'https://play.google.com/store/apps/details?id=de.speedclub.app');
    });
});

describe('WEB-04 /app-laden', function () {
    it('orders the store buttons by platform without hiding one, and says "Bald" while a store has no listing', function (string $agent, string $platform, array $order) {
        config(['speedclub.app_config.links.store_ios' => 'https://apps.apple.com/de/app/speed-club/id1', 'speedclub.app_config.links.store_android' => null]);

        $html = $this->withHeader('User-Agent', $agent)->get('/app-laden')->assertOk()->assertSee('data-platform="'.$platform.'"', false)->getContent();

        expect($html)->toContain('data-testid="WEB-04.store.ios"')
            ->toContain('href="https://apps.apple.com/de/app/speed-club/id1"')
            ->toContain('data-testid="WEB-04.soon.android"')
            ->toContain('Bald bei Google Play')
            ->and(strpos((string) $html, 'WEB-04.'.($order[0] === 'ios' ? 'store' : 'soon').'.'.$order[0]))->toBeLessThan(strpos((string) $html, 'WEB-04.'.($order[1] === 'ios' ? 'store' : 'soon').'.'.$order[1]));
    })->with([
        'iPhone' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)', 'ios', ['ios', 'android']],
        'Android' => ['Mozilla/5.0 (Linux; Android 16; Pixel 9)', 'android', ['android', 'ios']],
        'desktop' => ['Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)', 'desktop', ['ios', 'android']],
    ]);

    it('shows a desktop a QR code to this page, and a phone none', function () {
        $this->withHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0)')->get('/app-laden')->assertOk()->assertSee('data-testid="WEB-04.qr"', false)
            ->assertSee('src="data:image/svg+xml;base64,', false);
        $this->withHeader('User-Agent', 'Mozilla/5.0 (Linux; Android 16)')->get('/app-laden')->assertOk()->assertDontSee('data-testid="WEB-04.qr"', false);
    });

    it('draws the desktop QR as the §8 QR card, and only from the tablet width on (DQ-432)', function () {
        $html = (string) $this->withHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0)')->get('/app-laden')->assertOk()->getContent();

        expect($html)->toContain('class="mt-24 hidden items-center gap-24 tablet:flex" data-testid="WEB-04.qr"')
            ->toContain('<figure class="sc-qr shrink-0"')
            ->toContain('width="208" height="208"')
            ->toContain('data-testid="WEB-04.qrUrl">'.preg_replace('#^https?://#i', '', rtrim(config()->string('app.url'), '/')).'/app-laden<');
    });

    it('gives testers on staging the APK with its SHA-256, and nobody else a tester note', function () {
        $this->get('/app-laden')->assertOk()->assertDontSee('WEB-04.tester', false)->assertSee('Bald im App Store');

        $sha = str_repeat('ab12', 16);
        config(['speedclub.public_pages.tester_apk_url' => 'https://staging.speedclub.de/releases/speedclub-0.2.0.apk', 'speedclub.public_pages.tester_apk_sha256' => strtoupper($sha)]);

        $this->get('/app-laden')->assertOk()
            ->assertSee('data-testid="WEB-04.tester"', false)
            ->assertSee('href="https://staging.speedclub.de/releases/speedclub-0.2.0.apk"', false)
            ->assertSee($sha);

        config(['speedclub.public_pages.tester_apk_url' => 'javascript:alert(1)']);
        $this->get('/app-laden')->assertOk()->assertDontSee('WEB-04.tester', false)->assertDontSee('javascript:', false);
    });

    it('speaks English by link and starts no session', function () {
        $response = $this->get('/app-laden?lang=en')->assertOk()->assertSee('Coming soon to the App Store');

        expect($response->headers->getCookies())->toBe([]);
    });

    it('is linked from every public footer as "App laden" (ADR-148 h lifts)', function () {
        $this->get('/kontakt')->assertOk()->assertSee('data-testid="WEB.footer.get_app"', false)->assertSee('App laden');
    });
});

describe('WEB-07 /email/{action}', function () {
    it('offers the browser and the app for both actions, without any code in the page', function (string $action, string $route, string $title) {
        $response = $this->get("/email/$action")->assertOk()
            ->assertSee($title)
            ->assertSee('href="'.url('/app/'.$route).'"', false)
            ->assertSee('href="speedclub://'.$route.'"', false)
            ->assertSee('noindex', false);

        expect($response->headers->get('Cache-Control'))->toContain('no-store')
            ->and($response->headers->getCookies())->toBe([])
            // The script moves the fragment; nothing of a code is rendered by the server.
            ->and((string) $response->getContent())->toContain('location.hash')->not->toMatch('/\b\d{6}\b(?![^<]*nonce)/');
    })->with([
        'verify' => ['verify', 'verify-email', 'E-Mail-Adresse bestätigen'],
        'reset' => ['reset', 'reset-password', 'Neues Passwort festlegen'],
    ]);

    it('keeps "E-Mail" whole in the German body copy at any width (DQ-442)', function (string $action, string $joined) {
        $html = (string) $this->withHeader('Accept-Language', 'de')->get("/email/$action?lang=de")->assertOk()->getContent();

        // The title joins it too (r5 name-hyphen-break); the head carries the plain text (tab title, search snippet).
        [$head, $body] = explode('</head>', $html, 2);

        expect($body)->toContain($joined)->not->toContain('E-Mail')
            ->and($head)->not->toContain("\u{2060}");
    })->with([
        'verify' => ['verify', "aus der E-\u{2060}Mail ein."],
        'reset' => ['reset', "Der Code aus der E-\u{2060}Mail ist"],
    ]);

    it('knows only verify and reset', function () {
        $this->get('/email/delete')->assertNotFound();
    });

    it('drops any query but the language, so a code put there by mistake is not copied into the page (ADR-138)', function () {
        $this->get('/email/reset?code=123456&email=lena%40example.de&lang=en')->assertRedirect('/email/reset?lang=en');
        $this->get('/email/verify?code=123456')->assertRedirect('/email/verify');

        $html = (string) $this->get('/email/reset?lang=en')->assertOk()->getContent();
        expect($html)->not->toContain('123456')->toContain('Set a new password');
    });

    it('keeps the QA overrides of the screenshot matrix outside production and drops only the rest (M2.8 fix round)', function () {
        $qa = 'qaTheme=light&qaLocale=en&qaFontScale=2&qaState=default&qaMotion=off&qaNow=2026-11-08T10%3A00%3A00Z';

        $html = (string) $this->get('/email/reset?'.$qa)->assertOk()->getContent();
        expect($html)->toContain('data-qa-theme="light"')->toContain('Set a new password');

        $this->get('/email/verify?code=123456&'.$qa.'&lang=de')->assertRedirect('/email/verify?'.$qa.'&lang=de');
        $this->get('/email/verify?qaTheme[]=light&lang=en')->assertRedirect('/email/verify?lang=en');
    });

    it('leads with the inverse primary, not brand red, and keeps the remaining query when it clears the fragment (DQ-426)', function () {
        $html = (string) $this->get('/email/verify')->assertOk()->getContent();
        preg_match('/<a [^>]*data-testid="WEB-07.browser"[^>]*>/', $html, $browser);
        preg_match('/<a [^>]*data-testid="WEB-07.app"[^>]*>/', $html, $app);

        expect($browser[0] ?? '')->toContain('bg-inverse text-ink-inverse')->not->toContain('bg-accent-fill')
            ->and($app[0] ?? '')->toContain('bg-raised')
            ->and($html)->toContain("history.replaceState(null, '', location.pathname + location.search)");
        expect((string) file_get_contents(resource_path('css/public.css')))
            // The longhand (DQ-922: the shorthand would also reset text-wrap-mode). Only display.title balances (ADR-426 c).
            ->toContain('.sc-form-measure h1 { text-wrap-style: pretty; }')
            ->toContain('.sc-state-measure h1 { text-wrap-style: pretty; }')
            ->not->toMatch('~\.sc-(?:form|state)-measure h1 \{[^}]*balance~');
    });

    it('drops the QA overrides with the rest in production', function () {
        app()->detectEnvironment(fn () => 'production');

        $this->get('/email/reset?qaTheme=light&qaLocale=en')->assertRedirect('/email/reset');
        $this->get('/email/reset?qaTheme=light&lang=en')->assertRedirect('/email/reset?lang=en');
    });

    it('runs its script under the page nonce', function () {
        $response = $this->get('/email/reset')->assertOk();
        preg_match("/script-src[^;]*'nonce-([^']+)'/", (string) $response->headers->get('Content-Security-Policy'), $nonce);

        expect($nonce[1] ?? null)->not->toBeNull()
            ->and((string) $response->getContent())->toContain('<script nonce="'.$nonce[1].'">');
    });
});

describe('legal status of mods (ADR-153 lifted)', function () {
    it('seeds the flag on outside production', function () {
        expect(FeatureFlagSeeder::OFF_UNTIL_BUILT)->toBe([]);

        FeatureFlag::query()->where('key', 'sig.mod_legal_status')->delete();
        $this->seed(FeatureFlagSeeder::class);

        expect(FeatureFlag::query()->where('key', 'sig.mod_legal_status')->value('enabled'))->toBeTrue();
    });

    it('turns an existing flag on in the data update, outside production only', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.mod_legal_status'], ['enabled' => false]);
        $migration = require database_path('migrations/2026_11_13_170100_turn_on_mod_legal_status.php');

        $migration->up();
        expect(FeatureFlag::query()->where('key', 'sig.mod_legal_status')->value('enabled'))->toBeTrue();

        FeatureFlag::query()->where('key', 'sig.mod_legal_status')->update(['enabled' => false]);
        app()->detectEnvironment(fn (): string => 'production');
        $migration->up();
        app()->detectEnvironment(fn (): string => 'testing');

        expect(FeatureFlag::query()->where('key', 'sig.mod_legal_status')->value('enabled'))->toBeFalse();
    });

    it('is editable in PATCH mods/{id} and shown with its disclaimer, never as a search filter', function () {
        seedModSchema();
        sigFlag('sig.mod_legal_status');
        $owner = User::factory()->create();
        $vehicle = publishedVehicle($owner);
        $mod = modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power']);
        Sanctum::actingAs($owner);

        $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/mods/{$mod->id}", ['legal_status' => 'parts_certificate'])->assertOk();
        $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/mods/{$mod->id}")->assertOk()
            ->assertJsonPath('data.legal_status', 'parts_certificate')
            ->assertJsonPath('data.legal_disclaimer', 'Angaben des Besitzers, keine rechtliche Prüfung');

        // An unknown parameter is not a filter: the same builds with or without it.
        expect($this->getJson('/api/v1/search/vehicles?sort=newest&legal_status=abe')->assertOk()->json('data.*.id'))
            ->toBe($this->getJson('/api/v1/search/vehicles?sort=newest')->assertOk()->json('data.*.id'));
        expect(array_keys($this->getJson('/api/v1/search/facets')->assertOk()->json('data')))->not->toContain('legal_status');
    });
});

describe('failed mod photos (ADR-181 revisit)', function () {
    it('lists a failed mod photo for the owner only, apart from photos', function () {
        seedModSchema();
        $owner = User::factory()->create();
        $vehicle = publishedVehicle($owner);
        $mod = modIn($vehicle, 'exhaust', [], ['title' => 'HKS Hi-Power']);
        $failed = Media::factory()->forModel($mod)->create(['owner_id' => $owner->id, 'status' => MediaStatus::Failed, 'variants' => null]);
        $ready = Media::factory()->forModel($mod)->create(['owner_id' => $owner->id]);

        Sanctum::actingAs($owner);
        $data = $this->getJson("/api/v1/mods/{$mod->id}")->assertOk()->json('data');
        expect(array_column($data['failed_photos'], 'id'))->toBe([$failed->id])
            ->and($data['failed_photos'][0]['status'])->toBe('failed')
            ->and(array_column($data['photos'], 'id'))->toBe([$ready->id]);

        // Delete only: the owner clears it.
        $this->deleteJson("/api/v1/media/{$failed->id}")->assertNoContent();
        expect($this->getJson("/api/v1/mods/{$mod->id}")->json('data.failed_photos'))->toBe([]);

        Sanctum::actingAs(User::factory()->create());
        Media::factory()->forModel($mod)->create(['owner_id' => $owner->id, 'status' => MediaStatus::Failed, 'variants' => null]);
        expect($this->getJson("/api/v1/public/vehicles/{$vehicle->slug}/mods/{$mod->id}")->assertOk()->json('data.failed_photos'))->toBe([]);
    });
});
