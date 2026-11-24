<?php

use App\Enums\LegalDocumentKey;
use App\Enums\QrRevocationReason;
use App\Enums\Visibility;
use App\Models\FeatureFlag;
use App\Models\LegalDocument;
use App\Models\Media;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\PublicPhoto;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Support\PublicUrl;
use Database\Seeders\FeatureFlagSeeder;
use Database\Seeders\LegalDocumentSeeder;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * What a crawler, or a phone without JavaScript, gets. Rendering only: routes, status codes and the session live in PublicRoutesTest.
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz', 'city' => 'Stuttgart', 'bio' => 'Schraubt fast alles selbst.']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R', 'color' => 'Bayside Blue', 'model_year' => 2002, 'description' => 'Aus Japan importiert.']);
    $this->url = '/v/'.$this->vehicle->canonicalSlug();
});

/**
 * @return list<array<string, mixed>>
 */
function jsonLdBlocks(string $html): array
{
    preg_match_all('~<script type="application/ld\+json"[^>]*>(.*?)</script>~s', $html, $matches);

    return array_map(fn (string $json): array => json_decode($json, true, 32, JSON_THROW_ON_ERROR), $matches[1]);
}

function metaContent(string $html, string $property): ?string
{
    return preg_match('~<meta (?:property|name)="'.preg_quote($property, '~').'" content="([^"]*)"~', $html, $match) === 1 ? html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5) : null;
}

/**
 * @return list<string> the public pages of a seeded test, in all their kinds
 */
function everyPublicPage(string $vehicleUrl): array
{
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => 'Text.']);

    return ['/', $vehicleUrl, '/u/lukas.sc', '/impressum', '/c/ZZZZZZZZ', '/gibt-es-nicht'];
}

describe('WEB-01 without JavaScript', function () {
    it('holds all four sections, as plain anchored HTML', function () {
        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power']);

        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();

        foreach (['overview', 'specs', 'mods', 'history'] as $section) {
            expect($html)->toContain('<section id="'.$section.'"')->toContain('href="#'.$section.'"');
        }

        expect($html)
            ->toContain('Aus Japan importiert.')
            // DQ-926: the mod's name keeps "Hi-Power" whole (KeepTogether::shortNames, as the app's ModRow).
            ->toContain('HKS <span class="sc-keep">Hi-Power</span>')
            ->toContain('data-testid="VEH-01.eyebrow"')
            ->toContain('NISSAN')
            ->toContain('Bayside Blue');
    });

    it('sends the guest to the sign-in with next= for Follow, Message and the top bar, and to the sign-up for Registrieren', function () {
        $next = 'next=%2Fv%2F'.$this->vehicle->canonicalSlug();
        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->getContent();

        expect($html)
            ->toMatch('~href="[^"]*/app/sign-in\?'.$next.'"[^>]*data-testid="VEH-01.ownerRow.follow"~s')
            ->toMatch('~href="[^"]*/app/sign-in\?'.$next.'"[^>]*data-testid="VEH-01.ownerRow.message"~s')
            ->toMatch('~href="[^"]*/app/sign-in\?'.$next.'"[^>]*data-testid="WEB.topBar.signIn"~s')
            ->toMatch('~href="[^"]*/app/sign-up\?'.$next.'"[^>]*data-testid="WEB-01.register"~s');
    });

    it('keeps the deep link beside the plain link to the web app, and invents no store address', function () {
        $html = $this->get($this->url)->getContent();

        expect($html)
            ->toContain('data-deep-link="speedclub://v/'.$this->vehicle->canonicalSlug().'"')
            ->toContain('href="'.url('/app/v/'.$this->vehicle->canonicalSlug()).'"')
            ->not->toContain('apps.apple.com')
            ->not->toContain('play.google.com');
    });

    it('loads only the first photo with priority, and shows the counter and the 3-up photo preview of a real gallery (DQ-1048, DQ-1078)', function () {
        Media::factory()->count(5)->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        $html = $this->get($this->url)->getContent();

        expect(substr_count($html, 'fetchpriority="high"'))->toBe(2) // The image and its preload.
            ->and($html)->toContain('>1/6<')
            ->toContain('data-testid="WEB-01.photoPreview"')
            ->toContain('sc-veh-preview')
            ->not->toContain('data-testid="WEB-01.thumbs"')
            ->toContain('loading="lazy"')
            ->toContain('320w')
            ->toContain('1600w');
    });

    it('prints no counter for one photo', function () {
        expect($this->get($this->url)->getContent())->not->toContain('VEH-01.photoCount');
    });

    it('prints the focal point and placeholder into the nonced style block, not onto the element', function () {
        $this->vehicle->media()->firstOrFail()->forceFill(['focal_x' => 0.25, 'focal_y' => 0.75])->save();

        $html = $this->get($this->url)->getContent();

        expect($html)->toMatch('~<style nonce="[^"]*">[^<]*object-position:25% 75%[^<]*</style>~')
            ->toContain('background-image:url(data:image/png;base64,');
    });

    it('has a designed hero without photos: the empty stage photo with the identity on it, one line below (DQ-1168)', function () {
        $this->vehicle->media()->delete();
        $html = (string) $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();

        expect($html)
            ->toContain('data-testid="VEH-01.heroEmpty"')
            ->toContain('Noch keine Fotos')
            // DQ-927: the handle as it is, never hyphenated (KeepTogether::identifier).
            ->toContain('@<span class="sc-ident">lukas.<wbr>sc</span> hat für dieses Fahrzeug')
            ->toContain('data-testid="VEH-01.hero"')
            ->toContain('data-testid="WEB-01.stagePhoto"')
            ->toContain('/brand/photos/stage-empty-')
            // The stage is the page's LCP: the one high-priority image and its preload.
            ->and(substr_count($html, 'fetchpriority="high"'))->toBe(2)
            ->and($html)->toMatch('~class="sc-title-box sc-veh-identity sc-hero-identity"~')
            // No glyph tile where the hero belongs.
            ->not->toContain('sc-hero-empty');
    });

    it('names no owner when the owner said so', function () {
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();

        expect($this->get($this->url)->assertOk()->getContent())
            ->not->toContain('VEH-01.ownerRow')
            ->not->toContain('VEH-01.closingOwner')
            ->not->toContain('Lukas Scholz');
    });

    it('shows provenance under what is not a factory figure', function () {
        $this->vehicle->specs()->firstOrNew()->forceFill(['power_value' => 500, 'power_unit' => 'ps', 'power_ps' => 500, 'power_source' => 'measured'])->save();

        expect($this->withHeader('Accept-Language', 'de')->get($this->url)->getContent())->toMatch('~data-testid="WEB-01.provenance">Prüfstand<~');
    });

    it('keeps "GT-R" on one line in the shown name only, never in meta tags, JSON-LD or the share data (DQ-181)', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();
        $title = (string) $this->vehicle->fresh()?->getAttribute('model_text');

        // ADR-426 (c) as amended: a two-word name keeps its space breakable (no space would remain before "Skyline GT-R"), so
        // the trailing "GT-R" is not bound; it stays whole through its .sc-keep span.
        expect($html)->toMatch('~data-testid="VEH-01.title">Skyline <span class="sc-keep">GT-R</span></h1>~u')
            ->and($html)->not->toMatch('~data-testid="VEH-01.title">[^<]*<span class="sc-bind">~')
            ->and(metaContent($html, 'og:title'))->toContain('Skyline GT-R')->not->toContain('sc-keep')
            ->and(metaContent($html, 'description'))->not->toContain('sc-keep')
            ->and(json_encode(jsonLdBlocks($html)))->toContain('Skyline GT-R')->not->toContain('sc-keep')
            ->and($html)->toMatch('~data-share-title="[^"]*Skyline GT-R"~')
            ->and($html)->not->toContain("\u{2060}")
            ->and($title)->toBe('Skyline GT-R');
    });

    it('keeps a figure with its unit in the Verlauf and the mod row, as VEH-01 does (DQ-229)', function () {
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", [
            'category' => 'brakes',
            'brand_text' => 'AP Racing',
            'part_name' => 'Radi-CAL',
            'fields' => ['front_disc' => 356],
        ])->assertCreated();

        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();
        $section = function (string $id) use ($html): string {
            $part = substr($html, (int) strpos($html, '<section id="'.$id.'"'));

            return substr($part, 0, (int) strpos($part, '</section>'));
        };

        expect($section('history'))->toContain("356\u{00A0}mm")->not->toContain('356 mm')
            ->and($section('mods'))->toContain("356\u{00A0}mm")->not->toContain('356 mm');
    });

    it('never starts a Verlauf line with the arrow, and lets it wrap after the arrow (DQ-234)', function () {
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", [
            'category' => 'brakes',
            'brand_text' => 'AP Racing',
            'part_name' => 'Radi-CAL',
            'fields' => ['front_disc' => 356],
        ])->assertCreated();

        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();
        $history = substr($html, (int) strpos($html, '<section id="history"'));
        $history = substr($history, 0, (int) strpos($history, '</section>'));

        // A no-break space before the arrow, ordinary white space (where the line may wrap) after it.
        expect($history)->toMatch('~<span>Serie</span>&nbsp;<span class="text-ink-3">→</span>\s+<span>~u')
            ->not->toMatch('~</span>\s+<span class="text-ink-3">→~u');
    });

    it('shows the owner-stated legal status with the flags as seeded: outside production since M2.7, never in production (ADR-153 lifted)', function (string $environment, bool $shown) {
        app()->detectEnvironment(fn () => $environment);
        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();
        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power', 'legal_status' => 'parts_certificate']);
        modIn($this->vehicle, 'wheels_tires', ['diameter' => 18], ['title' => 'Volk TE37', 'legal_status' => 'not_required']);

        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->assertOk()->getContent();

        expect(strip_tags((string) $html))->toContain('HKS Hi-Power')->toContain('Volk TE37');

        if ($shown) {
            expect(substr_count((string) $html, 'data-testid="WEB-01.legalStatus"'))->toBeGreaterThanOrEqual(2)
                ->and($html)->toContain('Teilegutachten')->toContain('Eintragungsfrei')
                ->toContain('data-testid="WEB-01.legalDisclaimer">Angaben des Besitzers, keine rechtliche Prüfung</p>');
        } else {
            expect($html)->not->toContain('WEB-01.legalStatus')->not->toContain('Teilegutachten')->not->toContain('Eintragungsfrei');
        }
    })->with([['local', true], ['staging', true], ['production', false]]);

    it('closes a list of mods with the disclaimer of 08_LEGAL §7, where VEH-01 does, and only then', function () {
        expect($this->withHeader('Accept-Language', 'de')->get($this->url)->getContent())
            ->toContain('data-testid="WEB-01.modsEmpty"')
            ->not->toContain('WEB-01.legalDisclaimer');

        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power']);

        $html = $this->withHeader('Accept-Language', 'de')->get($this->url)->getContent();
        $mods = substr($html, (int) strpos($html, '<section id="mods"'));
        $mods = substr($mods, 0, (int) strpos($mods, '</section>'));

        expect(substr_count($html, 'data-testid="WEB-01.legalDisclaimer"'))->toBe(1)
            ->and($mods)->toMatch('~data-testid="WEB-01.legalDisclaimer">Angaben des Besitzers, keine rechtliche Prüfung</p>\s*$~')
            ->and($this->withHeader('Accept-Language', 'en')->get($this->url)->getContent())
            ->toContain('data-testid="WEB-01.legalDisclaimer">Stated by the owner, no legal review</p>');

        expect($this->withHeader('Accept-Language', 'de')->get($this->url.'?qaState=empty')->getContent())
            ->not->toContain('WEB-01.legalDisclaimer');
    });

    it('shows the owner-stated legal status beside the disclaimer once M2.7 turns the flag on', function () {
        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power', 'legal_status' => 'parts_certificate']);
        FeatureFlag::query()->create(['key' => 'sig.mod_legal_status', 'enabled' => true]);

        expect($this->withHeader('Accept-Language', 'de')->get($this->url)->getContent())
            ->toContain('data-testid="WEB-01.legalStatus"')
            ->toContain('data-testid="WEB-01.legalDisclaimer">Angaben des Besitzers, keine rechtliche Prüfung</p>');
    });

    it('puts the legal pill under the values in the text column and centres the install status, as VEH-01\'s ModRow (DQ-424)', function () {
        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power', 'legal_status' => 'parts_certificate']);
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.mod_legal_status'], ['enabled' => true]);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get($this->url)->getContent();
        $start = (int) strpos($html, '<li class="sc-mod-row');
        $row = substr($html, $start, (int) strpos($html, '</li>', $start) - $start);
        $text = substr($row, (int) strpos($row, '<div class="min-w-0 flex-1">'));
        $text = substr($text, 0, (int) strpos($text, '<div class="flex shrink-0 self-center">'));

        expect($row)->toContain('<div class="flex shrink-0 self-center">')
            // The legal pill is in the text column, after the values; the end column holds the install status alone.
            ->and($text)->toContain('data-testid="WEB-01.legalStatus"')
            ->and(strpos($text, 'Teilegutachten'))->toBeGreaterThan((int) strpos($text, 'Hi-Power</span>'))
            ->and(strpos($text, 'Hi-Power</span>'))->not->toBeFalse()
            ->and(substr($row, (int) strpos($row, 'self-center')))->not->toContain('WEB-01.legalStatus');
    });

    it('shows the designed zero state through qaState=empty, outside production only', function () {
        expect($this->withHeader('Accept-Language', 'de')->get($this->url.'?qaState=empty')->getContent())
            ->toContain('data-testid="VEH-01.heroEmpty"')
            ->toContain('data-testid="WEB-01.modsEmpty"')
            ->toContain('data-testid="WEB-01.historyEmpty"');

        app()->detectEnvironment(fn (): string => 'production');

        expect($this->get($this->url.'?qaState=empty')->getContent())->not->toContain('VEH-01.heroEmpty');
    });

    it('speaks German first and English on request', function () {
        expect($this->withHeader('Accept-Language', 'fr')->get($this->url)->getContent())
            ->toContain('lang="de"')->toContain('In der App öffnen')->toContain('Überblick')->toContain('Daten');

        foreach ([$this->get($this->url.'?lang=en'), $this->withHeader('Accept-Language', 'en-GB')->get($this->url)] as $response) {
            expect($response->getContent())
                ->toContain('lang="en"')->toContain('Open in the app')->toContain('Overview')->toContain('Specs')
                ->not->toContain('In der App öffnen');
        }
    });

    it('is the canonical of its own language', function () {
        $canonical = url($this->url);

        expect($this->get($this->url)->getContent())->toContain('<link rel="canonical" href="'.$canonical.'">')
            ->and($this->get($this->url.'?lang=en')->getContent())->toContain('<link rel="canonical" href="'.$canonical.'?lang=en">')
            ->toContain('hreflang="de" href="'.$canonical.'?lang=de"');
    });
});

describe('WEB-01 hero save control [SIG sig.saved_builds] (M2.1 review P1)', function () {
    it('offers Speichern on the hero and in the title row as a sign-in link back to this build, without JavaScript', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.saved_builds'], ['enabled' => true]);
        $signIn = e(url('/app/sign-in').'?next='.rawurlencode('/v/'.$this->vehicle->canonicalSlug()));

        $html = (string) $this->get($this->url)->assertOk()->getContent();

        expect($html)->toContain('data-testid="VEH-01.save"')
            ->toContain('data-testid="VEH-01.saveRow"')
            ->toContain('href="'.$signIn.'" class="sc-focus sc-hero-save" aria-label="'.__('public.vehicle.save').'"')
            ->toContain('<use href="#ph-bookmark-simple">')
            ->toContain('<symbol id="ph-bookmark-simple"');
        // Save comes before share in the action row (DQ-1047: the title row moved onto the hero).
        expect(strpos($html, 'VEH-01.saveRow'))->toBeLessThan((int) strpos($html, 'VEH-01.share'));
        // The hero chip lives inside the pager it sits on (M2.8 matrix: no interactive region lies across it), and the pager stays
        // unpositioned, so the hero remains the chip's containing block: it neither scrolls with the slides nor gets clipped.
        $pager = (int) strpos($html, 'data-pager');
        expect($pager)->toBeGreaterThan(0)
            ->and(strpos($html, 'data-testid="VEH-01.save"'))->toBeGreaterThan($pager)
            ->and(strpos($html, 'data-testid="VEH-01.save"'))->toBeLessThan((int) strpos($html, 'data-share-status'));
        preg_match('/\.sc-pager\s*\{([^}]*)\}/', (string) file_get_contents(resource_path('css/public.css')), $rule);
        expect($rule[1] ?? null)->not->toBeNull()->not->toContain('position');
    });

    it('leaves it out while the flag is off, and on a build without photos', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.saved_builds'], ['enabled' => false]);

        expect((string) $this->get($this->url)->getContent())->not->toContain('VEH-01.save');

        FeatureFlag::query()->updateOrCreate(['key' => 'sig.saved_builds'], ['enabled' => true]);
        Media::query()->delete();
        expect((string) $this->get($this->url)->getContent())->not->toContain('data-testid="VEH-01.save"');
    });
});

describe('SEO', function () {
    it('has Open Graph, Twitter and valid JSON-LD for a vehicle', function () {
        $html = $this->get($this->url)->getContent();
        $blocks = jsonLdBlocks($html);

        expect(metaContent($html, 'og:title'))->toContain('Skyline GT-R')
            ->and(metaContent($html, 'twitter:card'))->toBe('summary_large_image')
            ->and(metaContent($html, 'twitter:title'))->toBe(metaContent($html, 'og:title'))
            ->and(metaContent($html, 'twitter:image'))->toBe(metaContent($html, 'og:image'))
            ->and($blocks)->toHaveCount(2)
            // Car, the Vehicle of schema.org for passenger cars.
            ->and($blocks[0]['@type'])->toBe('Car')
            ->and($blocks[0]['@context'])->toBe('https://schema.org')
            ->and($blocks[0]['url'])->toBe(url($this->url))
            ->and($blocks[0]['vehicleModelDate'])->toBe('2002')
            ->and($blocks[1]['@type'])->toBe('BreadcrumbList')
            ->and($blocks[1]['itemListElement'][0]['position'])->toBe(1)
            ->and(end($blocks[1]['itemListElement'])['item'])->toBe(url($this->url));
    });

    it('gives each kind of page its own title', function () {
        $titles = collect(everyPublicPage($this->url))->map(function (string $path): string {
            preg_match('~<title>(.*?)</title>~s', (string) $this->get($path)->getContent(), $match);

            return $match[1];
        });

        expect($titles->unique()->count())->toBe($titles->count());
    });

    it('says noindex when the owner disabled search engines, on the vehicle and the member', function () {
        expect($this->get($this->url)->getContent())->not->toContain('name="robots"');

        $this->owner->forceFill(['indexable' => false])->save();

        expect($this->get($this->url)->getContent())->toContain('<meta name="robots" content="noindex">')
            ->and($this->get('/u/lukas.sc')->getContent())->toContain('<meta name="robots" content="noindex">');
    });
});

describe('hostile content', function () {
    it('stays text in the title, in attributes, in the body and in JSON-LD', function () {
        $short = '</title><script>alert(1)</script>"\'>';
        $hostile = $short.'<img src=x onerror=alert(2)>';

        $this->owner->forceFill(['display_name' => $short, 'city' => $short, 'bio' => $hostile])->save();
        $this->vehicle->forceFill(['model_text' => $short, 'description' => $hostile, 'color' => $short])->save();
        $this->vehicle->media()->firstOrFail()->forceFill(['alt' => $hostile])->save();
        modIn($this->vehicle, 'exhaust', [], ['title' => $hostile]);

        $url = '/v/'.$this->vehicle->refresh()->canonicalSlug();

        foreach ([$url, '/u/lukas.sc'] as $path) {
            $html = $this->get($path)->assertOk()->getContent();

            expect($html)
                ->not->toContain('<script>alert(1)')
                ->not->toContain('<img src=x')
                ->not->toContain('</title><script>');

            expect(substr_count($html, '<title>'))->toBe(1)
                ->and(metaContent($html, 'og:title'))->toContain('<script>alert(1)</script>')
                ->and(metaContent($html, 'twitter:title'))->toContain('<script>alert(1)</script>');
        }

        $blocks = jsonLdBlocks((string) $this->get($url)->getContent());

        expect($blocks[0]['description'])->toBe($hostile)
            ->and($blocks[0]['color'])->toBe($short)
            ->and($blocks[0]['name'])->toContain('<script>alert(1)</script>');
    });

    it('does not trust a query string it reflects into the language links', function () {
        $html = $this->get('/?x="><script>alert(3)</script>')->assertOk()->getContent();

        expect($html)->not->toContain('<script>alert(3)');
    });
});

describe('content security policy', function () {
    it('sends a nonce and no unsafe-inline, and every inline element carries that nonce', function () {
        foreach (everyPublicPage($this->url) as $path) {
            $response = $this->get($path);
            $policy = (string) $response->headers->get('Content-Security-Policy');

            preg_match("~script-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'~", $policy, $nonce);

            expect($nonce)->not->toBeEmpty($path)
                ->and($policy)->not->toContain('unsafe-inline')->not->toContain('unsafe-eval')
                ->toMatch("~style-src [^;]*'nonce-~");

            preg_match_all('~<(script|style)\b[^>]*>~', (string) $response->getContent(), $tags);

            foreach ($tags[0] as $tag) {
                expect($tag)->toContain('nonce="'.$nonce[1].'"');
            }
        }
    });

    it('has no style attribute and no inline handler, which that policy would block', function () {
        Media::factory()->count(2)->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

        foreach (everyPublicPage($this->url) as $path) {
            $html = preg_replace('~<(script|style)\b.*?</\1>~s', '', (string) $this->get($path)->getContent());

            expect($html)->not->toMatch('~<[^>]+\sstyle="~', $path)
                ->not->toMatch('~<[^>]+\son[a-z]+="~', $path);
        }
    });
});

describe('footer and QA contract', function () {
    it('reaches every legal page from every page, and promises nothing that does not exist yet', function () {
        foreach (everyPublicPage($this->url) as $path) {
            $html = (string) $this->get($path)->getContent();

            foreach (['/impressum', '/datenschutz', '/agb', '/community-richtlinien'] as $legal) {
                expect($html)->toContain('href="'.url($legal).'"');
            }

            // M2.5: /konto-loeschen (WEB-05) exists now and is linked from every footer.
            expect($html)->toContain('href="'.url('/konto-loeschen').'"')
                ->toContain('data-testid="WEB.footer.lang.en"');
        }
    });

    it('carries a language chosen with ?lang= from page to page', function () {
        $html = (string) $this->get($this->url.'?lang=en')->getContent();

        expect($html)->toContain('href="'.url('/impressum').'?lang=en"')
            ->toContain('href="'.url('/u/lukas.sc').'?lang=en"');
    });

    it('leaves addresses alone without ?lang=', function () {
        expect(PublicUrl::to('/agb'))->toBe(url('/agb'))
            ->and(PublicUrl::canonical(url('/agb')))->toBe(url('/agb'));
    });

    it('reports the overrides on every kind of page', function () {
        foreach (everyPublicPage($this->url) as $path) {
            $separator = str_contains($path, '?') ? '&' : '?';

            expect((string) $this->get($path.$separator.'qaTheme=light&qaLocale=en&qaFontScale=2&qaMotion=off')->getContent())
                ->toContain('data-qa-theme="light"')
                ->toContain('data-qa-locale="en"')
                ->toContain('data-qa-font-scale="2"')
                ->toContain('data-qa-state="default"')
                ->toContain('data-qa-motion="off"');
        }
    });

    it('shows the failure page through qaState=error', function () {
        expect($this->withHeader('Accept-Language', 'de')->get($this->url.'?qaState=error')->getContent())
            ->toContain('data-state="server_error"')
            ->toContain('data-qa-state="error"');
    });
});

describe('WEB-02', function () {
    it('shows FS-8 with real numbers, public vehicles only, and sends Follow and Message to the sign-in', function () {
        Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'visibility' => 'private', 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Geheim', 'model_text' => 'Versteckt']);

        $html = $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertOk()->getContent();

        expect($html)
            ->toContain('Lukas Scholz')
            ->toContain('@lukas.sc')
            ->toContain('Stuttgart')
            ->toContain('Mitglied seit')
            ->toContain('Schraubt fast alles selbst.')
            ->toMatch('~data-testid="WEB-02.stats">\s*<span class="sc-keep"><span[^>]*>1</span>~')
            ->toContain('Nissan Skyline GT-R')
            ->not->toContain('Versteckt')
            // With the way back since PROF-02 exists in the app (M2.1).
            ->toMatch('~href="[^"]*/app/sign-in\?next=%2Fu%2Flukas\.sc"[^>]*data-testid="WEB-02.follow"~s')
            ->toMatch('~href="[^"]*/app/sign-in\?next=%2Fu%2Flukas\.sc"[^>]*data-testid="WEB-02.message"~s');

        expect(metaContent($html, 'og:type'))->toBe('profile');
    });

    it('reads the stats as FS-8 and PROF-01 do, each one whole with its dot (DQ-224)', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertOk()->getContent();
        $stats = substr($html, (int) strpos($html, 'data-testid="WEB-02.stats"'));
        $stats = substr($stats, (int) strpos($stats, '>') + 1, (int) strpos($stats, '</p>') - (int) strpos($stats, '>') - 1);
        $text = trim((string) preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($stats), ENT_QUOTES | ENT_HTML5)));

        expect($text)->toBe('1 Fahrzeug · 0 Follower · 0 Folge ich')
            ->and(substr_count($stats, '<span class="sc-keep">'))->toBe(3)
            // A stat wraps only between stats, after its dot, so no line starts with one.
            ->and($stats)->toContain('&nbsp;·</span>')
            ->and($stats)->not->toMatch('~\s·~u');
    });

    it('prints the member\'s own cover when there is one, the brand stage otherwise, and overlaps the avatar (DQ-1234)', function () {
        $stage = PublicPhoto::brand('stage-empty');
        $html = (string) $this->get('/u/lukas.sc')->getContent();

        expect($html)->toContain('data-testid="WEB-02.cover" data-cover-source="stage"')->toContain('sc-prof is-covered')
            ->toContain((string) $stage['variants'][0]['path']);

        $cover = Media::factory()->forModel($this->owner)->create(['owner_id' => $this->owner->id]);
        $this->owner->forceFill(['cover_media_id' => $cover->id])->save();
        $html = (string) $this->get('/u/lukas.sc')->getContent();

        expect($html)->toContain('data-testid="WEB-02.cover" data-cover-source="own"')->toContain('sc-prof is-covered')
            ->toContain('sc-ph-'.strtolower((string) $cover->id))->not->toContain((string) $stage['variants'][0]['path']);
    });

    it('has a designed empty garage', function () {
        User::factory()->create(['username' => 'nina.neu']);

        expect($this->withHeader('Accept-Language', 'de')->get('/u/nina.neu')->assertOk()->getContent())
            ->toContain('data-testid="WEB-02.garageEmpty"')
            ->toContain('Noch keine öffentlichen Fahrzeuge');
    });
});

describe('WEB-02 cover (DQ-1169, DQ-1173)', function () {
    it('keeps a cover taken from a car only while that car is public, and never stacks it on the car\'s card', function () {
        $first = $this->vehicle->media()->firstOrFail();
        $second = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id, 'sort' => 5]);
        $this->owner->forceFill(['cover_media_id' => $first->id])->save();

        $html = (string) $this->get('/u/lukas.sc')->assertOk()->getContent();
        preg_match('~data-testid="WEB-02.garage".*?</ul>~s', $html, $garage);

        expect($html)->toContain('data-testid="WEB-02.cover"')
            ->and($garage[0])->toContain('sc-ph-'.strtolower((string) $second->id))->not->toContain('sc-ph-'.strtolower((string) $first->id));

        $this->vehicle->forceFill(['visibility' => Visibility::Private])->save();

        // The car's photo leaves the page with the car: the brand stage stands in (DQ-1234).
        expect($this->get('/u/lukas.sc')->assertOk()->getContent())->toContain('data-cover-source="stage"')
            ->not->toContain('sc-ph-'.strtolower((string) $first->id))
            ->and($this->get('/u/lukas.sc?qaState=empty')->getContent())->toContain('data-cover-source="stage"')
            ->not->toContain('sc-ph-'.strtolower((string) $first->id));
    });

    it('takes no build photo a garage card shows: 2 builds with 1 photo each give the brand stage (DQ-1234)', function () {
        $second = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'BMW', 'model_text' => 'M2', 'model_year' => 2018]);
        $photos = [$this->vehicle->media()->firstOrFail(), $second->media()->firstOrFail()];

        $html = (string) $this->get('/u/lukas.sc')->assertOk()->getContent();
        preg_match('~data-testid="WEB-02.cover".*?</div>~s', $html, $cover);
        preg_match('~data-testid="WEB-02.garage".*?</ul>~s', $html, $garage);

        expect($cover[0])->toContain('data-cover-source="stage"')
            ->toContain((string) PublicPhoto::brand('stage-empty')['variants'][0]['path']);

        foreach ($photos as $photo) {
            expect($cover[0])->not->toContain('sc-ph-'.strtolower((string) $photo->id))
                ->and($garage[0])->toContain('sc-ph-'.strtolower((string) $photo->id));
        }
    });

    it('takes a build photo only when that build\'s card can show its next one, main build first (DQ-1234)', function () {
        $second = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'BMW', 'model_text' => 'M2', 'model_year' => 2018]);
        $mainPhoto = $this->vehicle->media()->firstOrFail();
        $secondCover = $second->media()->firstOrFail();
        $secondNext = Media::factory()->forModel($second)->create(['owner_id' => $this->owner->id, 'sort' => 5]);

        $html = (string) $this->get('/u/lukas.sc')->assertOk()->getContent();
        preg_match('~data-testid="WEB-02.cover".*?</div>~s', $html, $cover);
        preg_match('~data-testid="WEB-02.garage".*?</ul>~s', $html, $garage);

        // The main build has one photo, so its card keeps it; the second build gives its cover and shows its next photo.
        expect($cover[0])->toContain('data-cover-source="build"')->toContain('sc-ph-'.strtolower((string) $secondCover->id))
            ->and($garage[0])->toContain('sc-ph-'.strtolower((string) $mainPhoto->id))
            ->toContain('sc-ph-'.strtolower((string) $secondNext->id))
            ->not->toContain('sc-ph-'.strtolower((string) $secondCover->id));
    });

    it('shows the badged sample card and one action in the empty garage (DQ-1169)', function () {
        User::factory()->create(['username' => 'nina.neu']);

        expect($this->withHeader('Accept-Language', 'de')->get('/u/nina.neu')->assertOk()->getContent())
            ->toContain('data-testid="WEB-02.garageSample"')->toContain('data-testid="WEB-02.garageSample.badges.sample"')
            ->toContain('data-testid="WEB-02.garageEmptyAction"')->toContain('Eigene Garage anlegen')
            ->not->toContain('<use href="#auto-wheel">');
    });
});

describe('public error state (DQ-1171)', function () {
    it('offers "Erneut laden" to the same address first and "Zur Startseite" as the quiet second, and no discover link', function () {
        $html = (string) $this->withHeader('Accept-Language', 'de')->get($this->url.'?qaState=error')->getContent();
        preg_match('~<a href="([^"]*)"[^>]*data-testid="WEB-STATE.retry"~', $html, $retry);

        expect($html)->toContain('Erneut laden')->toContain('Zur Startseite')->not->toContain('data-testid="WEB-STATE.discover"')
            ->and(html_entity_decode($retry[1]))->toEndWith($this->url)
            ->and(strpos($html, 'WEB-STATE.retry'))->toBeLessThan((int) strpos($html, 'WEB-STATE.home'));
    });
});

describe('WEB-03', function () {
    it('is the short page of R4-1.5: hero, four things to do, the sticker with a real scannable code, the download section', function () {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);

        $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect($html)
            // The claim of the spec, left-aligned in display.title, and one sentence; no second logo in the hero (R4DQ-61, the top bar's).
            ->toContain("Dein\u{00A0}Auto. Dein\u{00A0}Build. Dein\u{00A0}Club.")
            ->not->toContain('data-testid="WEB-03.logo"')
            ->toContain('data-testid="WEB-03.lead"')
            ->toContain('Was du mit Speedclub machst')
            ->toContain('data-testid="WEB-03.do.garage"')->toContain('data-testid="WEB-03.do.mods"')
            ->toContain('data-testid="WEB-03.do.meets"')->toContain('data-testid="WEB-03.do.discover"')
            ->toContain('data-testid="WEB-03.sticker"')->toContain('Das Kennzeichen steht nie drauf.')
            ->toContain('id="app"')
            // The M4.16 sections left the landing page.
            ->not->toContain('data-testid="WEB-03.steps"')
            ->not->toContain('data-testid="WEB-03.featured"')
            ->not->toContain('data-testid="WEB-03.events"')
            ->not->toContain('data-testid="WEB-03.business"')
            ->toContain('href="'.url('/v/'.$this->vehicle->canonicalSlug()).'"')
            // ADR-514: the sticker code is never printed on a public page (typed into POST spots it would count as a spot).
            ->not->toContain(mb_substr($qr->code, 0, 4).' '.mb_substr($qr->code, 4))
            ->not->toContain($qr->code)
            ->toMatch('~data-testid="WEB-03.qr".*?<svg~s')
            ->not->toContain('<?xml');
    });

    it('speaks English with ?lang=en', function () {
        $html = $this->get('/?lang=en')->assertOk()->getContent();

        expect($html)->toContain('What you do with Speedclub')->toContain('The sticker on your car')->toContain('Open in your browser')
            ->not->toContain('Was du mit Speedclub machst');
    });

    it('encodes and links the build page, not the sticker, so the landing page adds no scans to anybody\'s sticker', function () {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);
        $page = rtrim(config()->string('app.url'), '/').'/v/'.$this->vehicle->canonicalSlug();

        $html = (string) $this->get('/')->assertOk()->getContent();
        preg_match('~<figure class="sc-qr"[^>]*>\s*(?:\{\{--.*?--\}\}\s*)?<a href="([^"]+)"[^>]*>(.*?)</a>~s', $html, $sample);
        $svg = (string) preg_replace('/^<\?xml.*?\?>\s*/s', '', app(QrRenderer::class)->svg($page));

        expect($sample)->not->toBeEmpty()
            ->and(html_entity_decode($sample[1]))->toBe(url('/v/'.$this->vehicle->canonicalSlug()))
            ->and(trim($sample[2]))->toBe(trim($svg))
            ->and($html)->not->toContain('/C/'.$qr->code)
            ->not->toContain('/c/'.$qr->code);

        $this->withHeader('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')
            ->get(html_entity_decode($sample[1]))->assertOk();

        expect(QrScanDaily::query()->count())->toBe(0);
    });

    it('leads "App laden" to /app-laden until store links exist, then to the stores, and the browser always', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/')->getContent();

        expect($html)->toContain('Die App ist unterwegs.')->toMatch('~href="'.preg_quote(url('/app-laden'), '~').'"[^>]*data-testid="WEB-03.getApp"~')
            ->toMatch('~href="'.preg_quote(url('/app'), '~').'"[^>]*data-testid="WEB-03.openBrowser"~')
            ->toMatch('~href="'.preg_quote(url('/app-laden'), '~').'"[^>]*data-testid="WEB-03.appPage"~')
            ->not->toContain('data-testid="WEB-03.store"')->not->toContain('data-testid="WEB-03.heroStore"')
            ->not->toContain('Bald verfügbar')->not->toContain('apps.apple.com')->not->toContain('play.google.com');

        config(['speedclub.mobile.store_url_ios' => 'https://apps.apple.com/app/id1', 'speedclub.mobile.store_url_android' => 'nicht-https']);

        expect($this->withHeader('Accept-Language', 'de')->get('/')->getContent())
            ->toMatch('~href="https://apps.apple.com/app/id1"[^>]*data-testid="WEB-03.heroStore"~')
            ->toMatch('~href="https://apps.apple.com/app/id1"[^>]*data-testid="WEB-03.store"~')
            ->not->toContain('data-testid="WEB-03.getApp"')
            ->toContain('App Store')->not->toContain('Google Play')->not->toContain('Bald verfügbar');
    });

    it('links the sticker block to the shop only while the shop exists', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'shop'], ['enabled' => false]);
        expect($this->get('/')->getContent())->toContain('data-testid="WEB-03.sticker"')->not->toContain('data-testid="WEB-03.stickerShop"');

        FeatureFlag::query()->updateOrCreate(['key' => 'shop'], ['enabled' => true]);
        expect($this->get('/')->getContent())->toMatch('~href="'.preg_quote(url('/app/shop'), '~').'"[^>]*data-testid="WEB-03.stickerShop"~');
    });

    it('lets the code lead to the configured build, and falls back when it cannot be shown', function () {
        app(QrCodes::class)->ensureActive($this->vehicle);
        $other = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Honda', 'model_text' => 'NSX']);
        app(QrCodes::class)->ensureActive($other);
        modIn($this->vehicle, 'exhaust', [], ['title' => 'Mod']);
        $target = fn (): string => preg_match('~<figure class="sc-qr"[^>]*>\s*(?:\{\{--.*?--\}\}\s*)?<a href="([^"]+)"~s', (string) $this->get('/')->getContent(), $m) === 1 ? html_entity_decode($m[1]) : '';

        expect($target())->toBe(url('/v/'.$this->vehicle->canonicalSlug()));

        config(['speedclub.public_pages.featured_slug' => $other->canonicalSlug()]);
        expect($target())->toBe(url('/v/'.$other->canonicalSlug()));

        $other->forceFill(['visibility' => 'private'])->save();
        expect($target())->toBe(url('/v/'.$this->vehicle->canonicalSlug()));
    });

    it('leads to nothing private, hidden from search or of a member who is not public', function (Closure $hide) {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);
        $hide($this->vehicle, $this->owner);

        expect($this->get('/')->assertOk()->getContent())->not->toContain('data-testid="WEB-03.qr"')
            ->not->toContain(url('/v/'.$this->vehicle->canonicalSlug()))
            ->not->toContain(mb_substr($qr->code, 0, 4).' '.mb_substr($qr->code, 4));
    })->with([
        'private' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save()],
        'unlisted' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'unlisted'])->save()],
        'owner off search engines' => [fn (Vehicle $vehicle, User $owner) => $owner->forceFill(['indexable' => false])->save()],
        'owner off search engines, named by slug' => [function (Vehicle $vehicle, User $owner) {
            config(['speedclub.public_pages.featured_slug' => $vehicle->canonicalSlug()]);
            $owner->forceFill(['indexable' => false])->save();
        }],
        'draft' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['status' => 'draft'])->save()],
    ]);

    it('still reads without any build', function () {
        Vehicle::query()->delete();

        expect($this->get('/')->assertOk()->getContent())
            ->toContain('data-testid="WEB-03.do"')
            ->toContain('data-testid="WEB-03.sticker"')
            ->not->toContain('data-testid="WEB-03.qr"');
    });

    it('has the organisation and the website in JSON-LD', function () {
        $blocks = jsonLdBlocks((string) $this->get('/')->getContent());

        expect($blocks[0]['@type'])->toBe('Organization')->and($blocks[1]['@type'])->toBe('WebSite');
    });

    // R4DQ-23 (round-4 design review): one honest filled CTA. Without store links the web app is the way in that works today, so "Im
    // Browser öffnen" is red and "So kommst du zur App" (WEB-04) the secondary; with store links the stores lead and the browser link is
    // a quiet text link again (DQ-228).
    it('keeps red on one call to action: "Im Browser öffnen" without store links, the first store with them', function () {
        $html = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect(preg_match_all('~(?<![:\w-])bg-accent-fill(?![\w-])~', $html))->toBe(1)
            ->and(preg_match_all('~(?<![:\w-])bg-inverse(?![\w-])~', $html))->toBe(0)
            ->and($html)->toMatch('~bg-accent-fill [^>]*data-testid="WEB-03.openBrowser"~')
            ->and($html)->not->toMatch('~bg-accent-fill [^>]*data-testid="WEB-03.getApp"~')
            ->and($html)->toMatch('~href="[^"]*/app-laden"[^>]*data-testid="WEB-03.getApp">So kommst du zur App<~')
            ->and(strpos($html, 'data-testid="WEB-03.openBrowser"'))->toBeLessThan(strpos($html, 'data-testid="WEB-03.getApp"'));

        config(['speedclub.mobile.store_url_ios' => 'https://apps.apple.com/app/id1', 'speedclub.mobile.store_url_android' => 'https://play.google.com/store/apps/details?id=x']);
        $stores = $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect(preg_match_all('~(?<![:\w-])bg-accent-fill(?![\w-])~', $stores))->toBe(1)
            ->and(substr_count($stores, 'data-testid="WEB-03.heroStore"'))->toBe(2)
            ->and($stores)->toMatch('~bg-accent-fill [^>]*data-testid="WEB-03.heroStore"~')
            ->and($stores)->toMatch('~<a href="[^"]*" class="[^"]*underline[^"]*" data-testid="WEB-03.openBrowser"~')
            ->and($stores)->not->toContain('data-testid="WEB-03.getApp"');
    });
});

describe('WEB-06', function () {
    beforeEach(function () {
        $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
    });

    it('answers 410 for revoked, 404 for private and unknown, each calm, noindex, with a way forward and nothing of the vehicle', function (Closure $arrange, int $status, string $state, string $title) {
        $code = $arrange($this->vehicle, $this->qr);

        $html = $this->withHeader('Accept-Language', 'de')->get('/C/'.($code ?? $this->qr->code))->assertStatus($status)->getContent();

        expect($html)
            ->toContain('data-state="'.$state.'"')
            ->toContain($title)
            ->toContain('<meta name="robots" content="noindex">')
            ->toContain('href="'.url('/app/discover').'"')
            ->toContain('data-testid="WEB-06.home"')
            ->not->toContain('Skyline')
            ->not->toContain('lukas.sc')
            ->not->toContain('/v/'.$this->vehicle->canonicalSlug());
    })->with([
        'revoked' => [fn (Vehicle $vehicle) => tap(null, fn () => app(QrCodes::class)->revoke($vehicle, QrRevocationReason::Reissued)), 410, 'revoked', 'Dieser Sticker ist nicht mehr gültig'],
        'private' => [fn (Vehicle $vehicle) => tap(null, fn () => $vehicle->forceFill(['visibility' => 'private'])->save()), 404, 'private', 'Dieses Fahrzeug ist privat'],
        'unknown' => [fn () => 'ZZZZZZZZ', 404, 'not_found', 'Diesen Sticker kennen wir nicht'],
    ]);

    it('shows one glyph per state, the one the app shows, and has it in the sprite (DQ-172)', function (Closure $arrange, int $status, string $glyph) {
        $code = $arrange($this->vehicle, $this->qr);

        $html = $this->get('/C/'.($code ?? $this->qr->code))->assertStatus($status)->getContent();

        expect($html)->toContain('<use href="#ph-'.$glyph.'"></use>')
            ->and($html)->toContain('<symbol id="ph-'.$glyph.'"');
    })->with([
        'revoked' => [fn (Vehicle $vehicle) => tap(null, fn () => app(QrCodes::class)->revoke($vehicle, QrRevocationReason::Reissued)), 410, 'prohibit'],
        'private' => [fn (Vehicle $vehicle) => tap(null, fn () => $vehicle->forceFill(['visibility' => 'private'])->save()), 404, 'lock-simple'],
        'unknown' => [fn () => 'ZZZZZZZZ', 404, 'magnifying-glass'],
    ]);
});

describe('WEB-08', function () {
    it('shows version, date and a table of contents only for a text that needs one', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '3', 'body_md' => "## Eins\n\nText.\n\n## Zwei\n\nText.\n\n## Drei\n\nText.\n\n## Vier & mehr\n\nText."]);
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => "## Anbieter\n\nText."]);

        $long = (string) $this->withHeader('Accept-Language', 'de')->get('/datenschutz')->assertOk()->getContent();

        expect($long)
            ->toContain('data-testid="WEB-08.toc"')
            ->toContain('Version 3')
            ->toContain('<h2 id="s1-eins">Eins</h2>')
            ->toContain('href="#s1-eins"')
            ->toContain('href="#s4-vier-mehr"')
            ->toContain('>Vier &amp; mehr<');

        expect($this->withHeader('Accept-Language', 'de')->get('/impressum')->getContent())->not->toContain('WEB-08.toc');
    });

    it('keeps the date of a legal text on one line, as the app does (§4)', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => "## Anbieter\n\nText."]);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();

        expect($html)->toMatch('~data-testid="WEB-08\.version">Version [^<]*, gültig seit \d+\.\x{00A0}\p{L}+\x{00A0}\d{4}</p>~u');
    });

    it('takes its one h1 from the document\'s own heading, and the label without one', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'body_md' => "# Datenschutzerklärung <b>x</b>\n\nHier steht, was wir speichern.\n\n## Eins\n\nText."]);
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => "## Anbieter\n\nText."]);

        $privacy = (string) $this->withHeader('Accept-Language', 'de')->get('/datenschutz')->assertOk()->getContent();
        $imprint = (string) $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();

        expect(substr_count($privacy, '<h1'))->toBe(1)
            ->and($privacy)->toContain('data-testid="WEB-08.title">Datenschutzerklärung &lt;b&gt;x&lt;/b&gt;</h1>')
            ->toContain('<title>Datenschutzerklärung &lt;b&gt;x&lt;/b&gt; · Speedclub</title>')
            ->toContain('<p>Hier steht, was wir speichern.</p>')
            ->not->toContain('<b>x</b>')
            ->and(substr_count($imprint, '<h1'))->toBe(1)
            ->and($imprint)->toContain('data-testid="WEB-08.title">Impressum</h1>');
    });

    it('sets its title as title.1 and its body in the body colour, like SET-18 (DQ-218)', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => "# Impressum\n\n## Anbieter\n\nText."]);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();

        expect($html)->toMatch('~<h1 class="t-title-1 text-ink"\s+data-testid="WEB-08.title">Impressum</h1>~')
            ->not->toContain('t-display-title')
            ->toContain('class="sc-prose text-body text-ink"');
    });

    it('keeps an address one fact per line and a short prefix with its word (DQ-219, DQ-220)', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => "# Impressum\n\n## Anbieter\n\n[[Firmenname]]\\\nMusterstraße 1\nE-Mail: <kontakt@e-mail.de>\n\nDer QR-Code, die App-Kennung, der HU/AU-Monat, die USt-IdNr. und die Zwei-Faktor-Anmeldung, `E-Mail` und [E-Mail](https://speedclub.de/e-mail), <https://speedclub.de/foo-a-b>."]);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();
        $joiner = "\u{2060}";

        expect($html)->toContain("<p>[[Firmenname]]<br />\nMusterstraße 1\nE-{$joiner}Mail: <a href=\"mailto:kontakt@e-mail.de\">kontakt@e-mail.de</a></p>")
            ->toContain("Der QR-{$joiner}Code, die App-{$joiner}Kennung, der HU/AU-{$joiner}Monat, die USt-{$joiner}IdNr. und die Zwei-Faktor-Anmeldung, <code>E-Mail</code> und <a href=\"https://speedclub.de/e-mail\">E-{$joiner}Mail</a>, <a href=\"https://speedclub.de/foo-a-b\">https://speedclub.de/foo-a-b</a>.");
    });

    it('keeps a paragraph sign with its number in the seeded documents (DQ-221)', function (string $path, string $locale, string $joined) {
        $this->seed(LegalDocumentSeeder::class);

        expect((string) $this->withHeader('Accept-Language', $locale)->get($path)->assertOk()->getContent())
            ->toContain($joined);
    })->with([
        'imprint de' => ['/impressum', 'de', "nach \u{00A7}\u{00A0}27a UStG"],
        'imprint en' => ['/impressum', 'en', "under \u{00A7}\u{00A0}27a UStG"],
        'terms de' => ['/agb', 'de', "(\u{00A7}\u{00A0}315d StGB)"],
    ]);

    it('turns every seeded address block into lines (DQ-219)', function (LegalDocumentKey $key, string $locale, string $lines) {
        $this->seed(LegalDocumentSeeder::class);

        expect((string) $this->withHeader('Accept-Language', $locale)->get(match ($key) {
            LegalDocumentKey::Imprint => '/impressum',
            LegalDocumentKey::Privacy => '/datenschutz',
            default => '/agb',
        })->assertOk()->getContent())->toContain($lines);
    })->with([
        'imprint de' => [LegalDocumentKey::Imprint, 'de', "[[Firmenname]] [[Rechtsform]]<br />\n[[Anschrift]]<br />\n[[PLZ und Ort]]<br />\nDeutschland</p>"],
        'imprint en' => [LegalDocumentKey::Imprint, 'en', "[[Firmenname]] [[Rechtsform]]<br />\n[[Anschrift]]<br />\n[[PLZ und Ort]]<br />\nGermany</p>"],
        'privacy de' => [LegalDocumentKey::Privacy, 'de', "Deutschland<br />\nE-\u{2060}Mail: [[Datenschutz-\u{2060}E-\u{2060}Mail]]</p>"],
        'privacy en' => [LegalDocumentKey::Privacy, 'en', "Germany<br />\nEmail: [[Datenschutz-\u{2060}E-\u{2060}Mail]]</p>"],
        'terms de' => [LegalDocumentKey::Terms, 'de', "[[Anschrift]]<br />\n[[PLZ und Ort]]<br />\nDeutschland</p>"],
        'terms en' => [LegalDocumentKey::Terms, 'en', "[[Anschrift]]<br />\n[[PLZ und Ort]]<br />\nGermany</p>"],
    ]);

    it('stays safe with raw HTML in the source', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'body_md' => "## <script>alert(1)</script>\n\n## Zwei\n\n## Drei\n\n## Vier\n\n<img src=x onerror=alert(2)>"]);

        expect($this->withHeader('Accept-Language', 'de')->get('/agb')->assertOk()->getContent())
            ->not->toContain('<script>alert(1)')
            ->not->toContain('<img src=x');
    });
});

describe('placeholders', function () {
    it('turns a blurhash into a tiny PNG and something unreadable into nothing', function () {
        expect(PublicPhoto::placeholder('LEHV6nWB2yk8pyo0adR*.7kCMdnj'))->toStartWith('data:image/png;base64,')
            ->and(PublicPhoto::placeholder('nonsense'))->toBeNull()
            ->and(PublicPhoto::placeholder(null))->toBeNull();
    });

    it('lets nothing but numbers and base64 into a style rule', function () {
        $css = PublicPhoto::css(['id' => 'a}b<c', 'placeholder' => 'data:image/png;base64,AA});x{', 'focal_x' => 'red', 'focal_y' => 1], PublicPhoto::className(['id' => 'a}b<c']));

        expect($css)->toBe('')
            ->and(PublicPhoto::className(['id' => 'a}b<c']))->toBe('sc-ph-abc');
    });

    it('builds brand photos from the generated list, in the shape of the API', function () {
        $photo = PublicPhoto::brand('landing-hero');

        expect($photo['variants'][0]['url'])->toBe(url('/brand/photos/landing-hero-320.webp'))
            ->and(file_exists(public_path('brand/photos/landing-hero-320.webp')))->toBeTrue()
            ->and($photo['alt'])->toBeString();
    });
});

it('keeps the public JavaScript under 10 KB gzipped', function () {
    $manifest = public_path('build/manifest.json');

    if (! is_file($manifest)) {
        $this->markTestSkipped('No Vite build present.');
    }

    $entry = json_decode((string) file_get_contents($manifest), true)['resources/js/public/app.ts'];

    expect(strlen((string) gzencode((string) file_get_contents(public_path('build/'.$entry['file'])), 9)))->toBeLessThan(10 * 1024);
});
