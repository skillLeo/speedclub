<?php

use App\Actions\Garage\DeleteVehicle;
use App\Enums\LegalDocumentKey;
use App\Enums\QrRevocationReason;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\LegalDocument;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\DrawVehicleOgImage;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrSticker;
use App\Support\Codes;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * Security review of M1.7 (07_QA_AND_RELEASE §6). Each describe proves one control of the public pages, the QR resolver and the
 * downloads through the routes a stranger, a member or a crawler reaches, and attacks it. The happy paths live in PublicRoutesTest,
 * PublicPagesRenderTest, OgImagesTest, PlatformFilesTest and tests/Feature/Qr.
 */
const SEC17_BROWSER = 'Mozilla/5.0 (Linux; Android 14; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 SecAudit/1.0';

const SEC17_SHORT = '"\'><script>alert(1)</script><img src=x onerror=a()>';

const SEC17_LONG = SEC17_SHORT.'<a href="javascript:alert(3)">j</a><iframe src="//evil.example"></iframe><meta http-equiv="refresh" content="0;url=//evil.example"><!--';

beforeEach(function () {
    config(['session.driver' => 'database']);
    Storage::fake('public');
    // /sitemap.xml reads a file on the local disk and writes one when there is none: never the real one of the dev server.
    Storage::fake('local');
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas', 'city' => 'Stuttgart']);
    $this->vehicle = sec17Vehicle($this->owner, 'Nissan', 'Skyline GT-R');
    $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
});

/**
 * A published vehicle whose photo has real files, so the OG image is drawn and nothing gets reported.
 */
function sec17Vehicle(User $owner, string $make, string $model, array $attributes = []): Vehicle
{
    $vehicle = publishedVehicle($owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => $make, 'model_text' => $model, ...$attributes]);

    foreach ($vehicle->media()->firstOrFail()->getAttribute('variants') as $path) {
        Storage::disk('public')->put($path, TestImages::webp(1600, 1067));
    }

    return $vehicle->refresh();
}

function sec17Xpath(string $html): DOMXPath
{
    $dom = new DOMDocument;
    $previous = libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="utf-8"?>'.$html, LIBXML_NONET);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);

    return new DOMXPath($dom);
}

function sec17Nonce(TestResponse $response): string
{
    preg_match("~script-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'~", (string) $response->headers->get('Content-Security-Policy'), $match);

    expect($match)->not->toBeEmpty('no nonce in the CSP');

    return $match[1];
}

/**
 * Nothing a member typed may become markup that runs, loads or navigates: no foreign script, no handler, no frame, no meta refresh,
 * no script URL. Every script left is ours and carries the request's nonce.
 */
function sec17AssertInert(TestResponse $response, string $where): DOMXPath
{
    $nonce = sec17Nonce($response);
    $xpath = sec17Xpath((string) $response->getContent());
    $inline = 0;

    foreach ($xpath->query('//script') as $script) {
        /** @var DOMElement $script */
        expect($script->getAttribute('nonce'))->toBe($nonce, $where.': a script without the nonce');

        if ($script->hasAttribute('src')) {
            expect($script->getAttribute('src'))->toStartWith(url('/build/'), $where);
        } elseif ($script->getAttribute('type') === 'application/ld+json') {
            expect($script->textContent)->not->toContain('<')->not->toContain('>');
        } else {
            $inline++;
            expect($script->textContent)->not->toContain('alert(');
        }
    }

    expect($inline)->toBeLessThanOrEqual(1, $where.': only the theme script runs inline')
        ->and($xpath->query('//@*[starts-with(local-name(), "on")]')->length)->toBe(0, $where.': an inline handler')
        ->and($xpath->query('//iframe | //frame | //object | //embed | //base | //form | //meta[@http-equiv]')->length)->toBe(0, $where.': an active element')
        ->and($xpath->query('//title[not(ancestor::svg)]')->length)->toBe(1, $where.': a second title');

    foreach ($xpath->query('//@href | //@src | //@srcset | //@imagesrcset | //@action | //@formaction | //@poster | //@data') as $attribute) {
        expect(strtolower(preg_replace('/\s+/', '', $attribute->nodeValue)))
            ->not->toStartWith('javascript:')->not->toStartWith('vbscript:')->not->toStartWith('data:text')->not->toStartWith('file:');
    }

    return $xpath;
}

/**
 * The page without what differs per request (the nonce) and the address it was asked under (og:url, the language links).
 */
function sec17Normalised(TestResponse $response): string
{
    $html = (string) $response->getContent();
    $html = (string) preg_replace('~nonce="[^"]*"~', 'nonce=""', $html);
    $html = (string) preg_replace('~/([cCvu])/[^"?\s<#]*~', '/$1/X', $html);

    return $html;
}

/**
 * @return array<string, list<string>> every row of every table of the test database, as JSON
 */
function sec17Snapshot(): array
{
    $rows = [];

    foreach (Schema::getTableListing(DB::connection()->getDatabaseName(), false) as $table) {
        if ($table !== 'migrations') {
            $rows[$table] = DB::table($table)->get()->map(fn (object $row): string => (string) json_encode($row, JSON_INVALID_UTF8_SUBSTITUTE))->sort()->values()->all();
        }
    }

    return $rows;
}

function sec17Cookie(User $member): string
{
    app('session')->forgetDrivers();

    return databaseSessionFor($member, 'web');
}

describe('output encoding of member text', function () {
    beforeEach(function () {
        seedModSchema();
        $this->owner->forceFill(['display_name' => SEC17_SHORT, 'city' => SEC17_SHORT, 'bio' => SEC17_LONG])->save();
        $this->vehicle->forceFill(['make_text' => SEC17_SHORT, 'model_text' => SEC17_SHORT, 'nickname' => SEC17_SHORT, 'color' => SEC17_SHORT, 'description' => SEC17_LONG])->save();
        $this->vehicle->media()->firstOrFail()->forceFill(['alt' => SEC17_LONG])->save();
        modIn($this->vehicle, 'exhaust', [], ['title' => SEC17_SHORT.' HKS', 'brand_text' => SEC17_SHORT]);
        $this->url = '/v/'.$this->vehicle->refresh()->canonicalSlug();
        config(['speedclub.public_pages.featured_slug' => $this->vehicle->canonicalSlug()]);
    });

    it('keeps it text in the body, in attributes and in the share button of every page that shows it', function (string $page) {
        $path = $page === 'vehicle' ? $this->url : ($page === 'member' ? '/u/lukas.sc' : '/');

        $response = $this->get($path)->assertOk();
        $xpath = sec17AssertInert($response, $path);

        $texts = array_map(fn (DOMNode $node): string => $node->textContent, iterator_to_array($xpath->query('//body//*[not(self::script) and not(self::style)]/text()')));

        expect(implode("\n", $texts))->toContain('<script>alert(1)</script>');
    })->with(['vehicle', 'member', 'landing with the build configured']);

    it('prints it into Open Graph, Twitter and the description as one attribute each', function (string $path) {
        $path = $path === 'vehicle' ? $this->url : $path;
        $xpath = sec17Xpath((string) $this->get($path)->assertOk()->getContent());

        foreach (['og:title', 'twitter:title', 'og:description', 'description', 'og:image:alt'] as $name) {
            $meta = $xpath->query('//meta[@property="'.$name.'" or @name="'.$name.'"]');

            // One alt per og:image: the 1200 × 630 card and the square.
            expect($meta->length)->toBe($name === 'og:image:alt' ? 2 : 1, $name);
        }

        expect($xpath->query('//meta[@property="og:title"]')->item(0)->getAttribute('content'))->toContain('<script>alert(1)</script>')
            ->and($xpath->query('//meta[@property="og:image"]')->item(0)->getAttribute('content'))->toStartWith(url('/'));
    })->with(['vehicle', '/u/lukas.sc']);

    it('cannot leave a JSON-LD block, which holds no angle bracket and decodes to the exact text', function () {
        // On the raw markup: an HTML parser ends a script at the first "</" plus a letter and would hide the very bracket looked for.
        preg_match_all('~<script type="application/ld\+json"[^>]*>(.*?)</script>~s', (string) $this->get($this->url)->assertOk()->getContent(), $blocks);

        expect($blocks[1])->toHaveCount(2);

        foreach ($blocks[1] as $block) {
            expect($block)->not->toMatch('~[<>]~');
        }

        $vehicle = json_decode($blocks[1][0], true, 32, JSON_THROW_ON_ERROR);

        expect($vehicle['description'])->toBe(SEC17_LONG)
            ->and($vehicle['color'])->toBe(SEC17_SHORT);
    });

    it('escapes the username on the sticker sheet, and dompdf may neither fetch nor run anything', function () {
        $data = [...app(QrSticker::class)->viewData($this->qr), 'username' => 'x"><img src=x onerror=a()><script>alert(1)</script>'];
        $html = view('pdf.qr-sticker', $data)->render();
        $xpath = sec17Xpath($html);

        expect($xpath->query('//script')->length)->toBe(0)
            ->and($xpath->query('//@*[starts-with(local-name(), "on")]')->length)->toBe(0)
            ->and($xpath->query('//img')->length)->toBe(2)
            ->and($html)->toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

        $options = app('dompdf.wrapper')->getDomPDF()->getOptions();

        expect($options->getIsRemoteEnabled())->toBeFalse()
            ->and($options->getIsPhpEnabled())->toBeFalse()
            ->and($options->getChroot())->not->toBeEmpty();

        // Local files only from inside the project: a narrower chroot passes, a wider one does not.
        foreach ($options->getChroot() as $root) {
            expect(realpath($root))->toBeString()->toStartWith((string) realpath(base_path()));
        }
    });
});

describe('legal pages render Markdown in safe mode', function () {
    it('drops every script URL, raw HTML and handler, also in headings and the table of contents', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => implode("\n\n", [
            '# Impressum <img src=x onerror=a()>',
            '## <img src=x onerror=alert(1)>Erster Abschnitt',
            '## Zweiter "><script>alert(2)</script>',
            '## Dritter &lt;script&gt;alert(3)&lt;/script&gt;',
            '## Vierter',
            '[a](javascript:alert(4)) [b](JaVaScRiPt:alert(5)) [c](&#106;avascript:alert(6)) [d](vbscript:msgbox(7)) [e](data:text/html;base64,PHNjcmlwdD4=) [f](file:///etc/passwd) [g](%6A%61vascript:alert(8))',
            '<javascript:alert(9)>',
            '![h](javascript:alert(10))',
            "[i][ref]\n\n[ref]: javascript:alert(11)",
            '<iframe src="https://evil.example"></iframe>',
            '<svg onload=alert(12)>',
            '<!-- <script>alert(13)</script> -->',
            '[j](https://example.org "\" onmouseover=\"alert(14)")',
        ])]);

        $response = $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk();
        $xpath = sec17AssertInert($response, '/impressum');

        expect($xpath->query('//*[@data-testid="WEB-08.root"]//*[self::svg or self::iframe or self::script or self::object]')->length)->toBe(0)
            ->and($xpath->query('//*[@data-testid="WEB-08.toc"]//a')->length)->toBe(4)
            ->and($xpath->query('//*[@data-testid="WEB-08.toc"]//a/*')->length)->toBe(0)
            ->and($xpath->query('//*[@data-testid="WEB-08.title"]/*')->length)->toBe(0)
            ->and($xpath->query('//a[@href="https://example.org"]')->length)->toBe(1);

        foreach ($xpath->query('//*[@data-testid="WEB-08.body"]//h2') as $heading) {
            expect($heading->getAttribute('id'))->toMatch('~^s\d+-[a-z0-9-]*$~');
        }

        // The image of "![h](javascript:…)" keeps an empty src; whatever has a scheme at all is the one https link.
        foreach ($xpath->query('//*[@data-testid="WEB-08.root"]//@href | //*[@data-testid="WEB-08.root"]//@src') as $url) {
            if (preg_match('~^\s*[a-z][a-z0-9+.-]*:~i', $url->nodeValue) === 1) {
                expect($url->nodeValue)->toBe('https://example.org');
            }
        }
    });

    it('shows only the version in force: no draft and no scheduled text, on the page or in the sitemap', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '1', 'body_md' => "# Impressum\n\nFassung in Kraft."]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '2', 'body_md' => "# Impressum\n\nInterner Entwurf."]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'version' => '3', 'published_at' => now()->addDay(), 'body_md' => "# Impressum\n\nKommende Fassung."]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '4', 'body_md' => "# AGB\n\nNur ein Entwurf."]);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Privacy, 'locale' => 'de', 'version' => '5', 'published_at' => now()->addHour(), 'body_md' => "# Datenschutz\n\nNoch nicht in Kraft."]);

        $imprint = $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk();

        expect($imprint->getContent())->toContain('Fassung in Kraft.')->not->toContain('Interner Entwurf')->not->toContain('Kommende Fassung');

        foreach (['/agb' => 'Nur ein Entwurf', '/datenschutz' => 'Noch nicht in Kraft'] as $path => $text) {
            expect($this->withHeader('Accept-Language', 'de')->get($path)->assertNotFound()->getContent())->not->toContain($text);
        }

        expect(app(SitemapWriter::class)->render())->toContain('/impressum')->not->toContain('/agb')->not->toContain('/datenschutz');
    });
});

describe('content security policy', function () {
    it('sends a fresh nonce on every public answer, error states included, with the strict directives', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);
        config(['speedclub.rate_limits.public_read.max' => 1]);
        RateLimits::register();

        $nonces = [];

        foreach (['/', '/', '/c/'.$this->qr->code, '/c/ZZZZZZZZ', '/gibt-es-nicht', '/?qaState=error'] as $path) {
            // The nonce is a scoped binding: every PHP request gets a new container, a test reuses one.
            app()->forgetScopedInstances();
            $response = $this->get($path);
            $policy = (string) $response->headers->get('Content-Security-Policy');

            expect($policy)->toContain("object-src 'none'")->toContain("base-uri 'self'")->toContain("frame-ancestors 'none'")
                ->not->toContain('unsafe-inline')->not->toContain('unsafe-eval')->not->toContain('*')
                ->and($response->headers->get('X-Frame-Options'))->toBe('DENY')
                ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff');

            $nonces[] = sec17Nonce($response);
        }

        // The second '/' was over the limit of 1: the 429 page has its policy too.
        expect($this->get('/')->assertStatus(429)->headers->get('Content-Security-Policy'))->toContain("'nonce-")
            ->and(array_unique($nonces))->toHaveCount(count($nonces));
    });
});

describe('a revoked, private or unknown code reveals nothing', function () {
    it('answers byte for byte the same revoked page for any vehicle and any reason it may not name, with no header about the vehicle', function () {
        $other = User::factory()->create(['username' => 'kenji.r34', 'display_name' => 'Kenji']);
        $second = sec17Vehicle($other, 'Toyota', 'Supra', ['visibility' => 'unlisted']);
        $secondCode = app(QrCodes::class)->ensureActive($second);
        $third = sec17Vehicle($other, 'Honda', 'NSX');
        $thirdCode = app(QrCodes::class)->ensureActive($third);
        $fourth = sec17Vehicle($other, 'Mazda', 'RX-7');
        $fourthCode = app(QrCodes::class)->ensureActive($fourth);
        $fifth = sec17Vehicle($this->owner, 'BMW', 'Z8 Roadster');
        $fifthCode = app(QrCodes::class)->ensureActive($fifth);

        // A replaced sticker and a staff takedown give no reason. A deleted vehicle and a deleted account read "nicht mehr verfügbar"
        // (02_PRODUCT_SPEC §3.2), also after the hard delete, and cannot be told apart from each other.
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);
        app(QrCodes::class)->revoke($second, QrRevocationReason::Moderation);
        app(DeleteVehicle::class)->handle($other, $third);
        app(QrCodes::class)->revoke($fourth, QrRevocationReason::AccountDeleted);
        app(DeleteVehicle::class)->handle($this->owner, $fifth);
        Vehicle::withTrashed()->whereKey($fifth->id)->update(['deleted_at' => now()->subDays(31)]);
        $this->artisan('vehicles:prune')->assertSuccessful();

        $groups = ['revoked' => [$this->qr->code, $secondCode->code], 'unavailable' => [$thirdCode->code, $fourthCode->code, $fifthCode->code]];
        $seen = [];

        foreach ($groups as $copy => $codes) {
            $pages = [];
            $api = [];

            foreach ($codes as $code) {
                $response = $this->withHeader('Accept-Language', 'de')->get('/C/'.$code)->assertStatus(410);

                expect($response->headers->has('Location'))->toBeFalse()
                    ->and($response->headers->has('Link'))->toBeFalse()
                    ->and($response->headers->has('ETag'))->toBeFalse()
                    ->and($response->headers->get('Cache-Control'))->toContain('no-store')
                    ->and(sec17Xpath((string) $response->getContent())->query('//meta[@property="og:image"]')->item(0)->getAttribute('content'))->toBe(app(OgImages::class)->defaultUrl())
                    ->and($response->getContent())->not->toContain('Skyline')->not->toContain('Supra')->not->toContain('NSX')->not->toContain('RX-7')->not->toContain('Z8 Roadster')
                    ->not->toContain('lukas.sc')->not->toContain('kenji.r34')->not->toContain('/v/')->not->toContain('Besitzer');

                $pages[] = sec17Normalised($response);
                $api[] = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/qr/'.$code)->assertOk()->json();
            }

            expect(array_unique($pages))->toHaveCount(1, $copy)
                ->and(array_unique(array_map('json_encode', $api)))->toHaveCount(1, $copy)
                ->and($api[0]['data']['state'])->toBe('revoked')
                ->and($api[0]['data']['slug'])->toBeNull();

            $seen[$copy] = $api[0]['data']['title'];
        }

        expect($seen)->toBe(['revoked' => "Dieser QR-\u{2060}Code ist nicht mehr gültig", 'unavailable' => 'Dieses Fahrzeug ist nicht mehr verfügbar']);
    });

    it('answers the same private page whatever hides the vehicle, so a suspension or a block cannot be told apart', function () {
        $hide = [
            'private' => fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save(),
            'suspended owner' => fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['status' => 'suspended'])->save(),
            'unverified owner' => fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['email_verified_at' => null])->save(),
            'deactivated owner' => fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['status' => 'deactivated'])->save(),
            'deleted account' => fn (Vehicle $vehicle) => $vehicle->owner->delete(),
        ];

        $pages = [];
        $api = [];

        foreach ($hide as $why => $apply) {
            $owner = User::factory()->create(['username' => 'owner.'.substr(md5($why), 0, 6)]);
            $vehicle = sec17Vehicle($owner, 'Porsche', '911 '.$why);
            $code = app(QrCodes::class)->ensureActive($vehicle)->code;
            $apply($vehicle->load('owner'));

            $response = $this->get('/c/'.$code)->assertNotFound();

            expect($response->getContent())->not->toContain('911')->not->toContain($owner->username)->not->toContain('/v/');

            $pages[$why] = sec17Normalised($response);
            $api[$why] = json_encode($this->getJson('/api/v1/qr/'.$code)->assertOk()->json());
        }

        // A block, from a signed-in browser.
        $blocked = User::factory()->create();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $blocked->id]);
        $pages['block'] = sec17Normalised($this->withCookie(config()->string('session.cookie'), sec17Cookie($blocked))->get('/c/'.$this->qr->code)->assertNotFound());

        expect(array_unique($pages))->toHaveCount(1)
            ->and(array_unique($api))->toHaveCount(1)
            ->and($pages['private'])->toContain('data-state="private"');
    });

    it('answers the same unknown page for a code nobody has, a draft and malformed input, and matches no wildcard', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $draftCode = app(QrCodes::class)->ensureActive($draft)->code;

        $pages = [];

        foreach (['ZZZZZZZZ', $draftCode, 'kaputt!', '________', '%25%25%25%25%25%25%25%25', str_repeat('A', 300)] as $code) {
            $response = $this->get('/c/'.$code)->assertNotFound();

            expect($response->getContent())->not->toContain('Skyline')->not->toContain('/v/');

            $pages[] = sec17Normalised($response);
        }

        expect(array_unique($pages))->toHaveCount(1)
            ->and($pages[0])->toContain('data-state="not_found"');
    });

    it('leaves a vehicle the hard delete took without its revoke a tombstone that names nothing', function () {
        $gone = sec17Vehicle($this->owner, 'BMW', 'Z8 Roadster');
        $goneCode = app(QrCodes::class)->ensureActive($gone)->code;
        $gone->forceDelete();

        $response = $this->get('/c/'.$goneCode)->assertStatus(410)->assertSee('data-state="revoked"', false);

        expect($response->getContent())->not->toContain('Z8 Roadster')->not->toContain('lukas.sc')->not->toContain('/v/')
            ->and($this->getJson('/api/v1/qr/'.$goneCode)->json('data.slug'))->toBeNull();
    });

    it('does not let a hidden vehicle\'s slug or a hidden member\'s new name out through a redirect', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();
        $other = User::factory()->create(['username' => 'neuer.name', 'previous_username' => 'alter.name', 'username_changed_at' => now()->subDay(), 'status' => 'suspended']);

        $wrongText = $this->get('/v/anderer-text-'.strtolower($this->vehicle->public_id))->assertNotFound();
        $nobody = $this->get('/v/anderer-text-'.strtolower(Codes::generate()))->assertNotFound();
        $oldName = $this->get('/u/alter.name')->assertNotFound();
        $unknown = $this->get('/u/gibt.es.nicht')->assertNotFound();

        expect(sec17Normalised($wrongText))->toBe(sec17Normalised($nobody))
            ->and(sec17Normalised($oldName))->toBe(sec17Normalised($unknown))
            ->and($wrongText->getContent())->not->toContain('skyline')
            ->and($oldName->getContent())->not->toContain($other->username);
    });
});

describe('codes cannot be guessed and the resolver is rate limited', function () {
    it('draws codes from the whole alphabet in every position, unrelated to the vehicle, and replaces them with unrelated ones', function () {
        $codes = collect(range(1, 2000))->map(fn (): string => Codes::generate());

        expect($codes->unique())->toHaveCount(2000);

        foreach (range(0, Codes::LENGTH - 1) as $position) {
            expect($codes->map(fn (string $code): string => $code[$position])->unique())->toHaveCount(32);
        }

        Sanctum::actingAs($this->owner);
        $new = $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk()->json('data.code');

        expect($new)->not->toBe($this->qr->code)
            ->and([$this->qr->code, $new])->not->toContain($this->vehicle->public_id)
            ->and(str_contains(strtoupper($this->vehicle->id), $new))->toBeFalse();
    });

    it('counts /c, /C, the API, HEAD and every spelling against one budget per address, whatever forwarding headers claim', function () {
        config(['speedclub.rate_limits.qr.max' => 5]);
        RateLimits::register();
        $code = $this->qr->code;
        $spoof = fn (string $ip): array => [
            'REMOTE_ADDR' => '198.51.100.7',
            'HTTP_X_FORWARDED_FOR' => $ip,
            'HTTP_X_REAL_IP' => $ip,
            'HTTP_FORWARDED' => 'for='.$ip,
            'HTTP_CLIENT_IP' => $ip,
            'HTTP_CF_CONNECTING_IP' => $ip,
            'HTTP_TRUE_CLIENT_IP' => $ip,
        ];

        $this->call('GET', '/c/'.$code, server: $spoof('203.0.113.1'))->assertRedirect();
        $this->call('GET', '/C/'.strtolower($code), server: $spoof('203.0.113.2'))->assertRedirect();
        $this->call('GET', '/c/'.str_replace(['0', '1'], ['O', 'L'], $code), server: $spoof('203.0.113.3'))->assertStatus(302);
        $this->call('GET', '/api/v1/qr/'.$code, server: [...$spoof('203.0.113.4'), 'HTTP_ACCEPT' => 'application/json'])->assertOk();
        $this->call('HEAD', '/c/'.$code, server: $spoof('203.0.113.5'))->assertRedirect();

        $this->call('GET', '/c/'.$code, server: $spoof('203.0.113.6'))->assertStatus(429);
        $this->call('GET', '/api/v1/qr/ZZZZZZZZ', server: [...$spoof('203.0.113.7'), 'HTTP_ACCEPT' => 'application/json'])->assertStatus(429);

        // Somebody else is not affected.
        $this->call('GET', '/c/'.$code, server: ['REMOTE_ADDR' => '198.51.100.8'])->assertRedirect();
    });
});

describe('hidden, unlisted and noindex hold on every public surface', function () {
    it('keeps a hidden build off the page, the scan, the resolver, the owner page, the landing page, the sitemap and the OG image', function (Closure $hide) {
        config(['speedclub.public_pages.featured_slug' => $this->vehicle->canonicalSlug()]);
        $slug = $this->vehicle->canonicalSlug();
        $id = strtolower($this->vehicle->public_id);

        // The picture exists while the build is public, so its removal is what gets proven here, not its absence from the start.
        (new DrawVehicleOgImage($this->vehicle->id))->handle(app(OgImages::class));
        $og = (string) Vehicle::query()->whereKey($this->vehicle->id)->value('og_image_path');
        Storage::disk('public')->assertExists($og);
        $card = app(OgImages::class)->forVehicle(Vehicle::query()->with(OgImages::VEHICLE_RELATIONS)->findOrFail($this->vehicle->id));
        expect($card)->toContain('/og/v/');

        $hide($this->vehicle, $this->owner);
        $vehicle = Vehicle::withTrashed()->with('owner')->findOrFail($this->vehicle->id);

        $page = $this->get('/v/'.$slug)->assertNotFound();

        $scan = $this->get('/c/'.$this->qr->code);
        expect($scan->status())->not->toBe(302)
            ->and($scan->getContent())->not->toContain($id);

        $member = $this->get('/u/lukas.sc');
        $landing = $this->get('/')->assertOk();

        foreach ([$page, $scan, $member, $landing] as $response) {
            expect($response->getContent())->not->toContain(basename($og));
        }

        // What hides the build elsewhere than in an Action (a suspension, a deleted account) is swept up by the nightly og:prune.
        $this->artisan('og:prune')->assertSuccessful();

        expect($this->getJson('/api/v1/qr/'.$this->qr->code)->json('slug'))->toBeNull()
            ->and($member->getContent())->not->toContain($id)
            ->and($landing->getContent())->not->toContain($id)->not->toContain($this->qr->code)
            ->and(app(SitemapWriter::class)->render())->not->toContain($id)
            ->and(Storage::disk('public')->files('og/v'))->toBe([])
            ->and(app(OgImages::class)->forVehicle($vehicle))->toBe(app(OgImages::class)->defaultUrl());

        // The address the build's card had answers nothing any more, in both formats.
        $this->get($card)->assertNotFound();
        $this->get(str_replace('.jpg', '-square.jpg', $card))->assertNotFound();
    })->with([
        'private' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save()],
        'draft' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['status' => 'draft'])->save()],
        'deleted' => [fn (Vehicle $vehicle, User $owner) => app(DeleteVehicle::class)->handle($owner, $vehicle)],
        'suspended owner' => [fn (Vehicle $vehicle, User $owner) => $owner->forceFill(['status' => 'suspended'])->save()],
        'unverified owner' => [fn (Vehicle $vehicle, User $owner) => $owner->forceFill(['email_verified_at' => null])->save()],
        'deactivated owner' => [fn (Vehicle $vehicle, User $owner) => $owner->forceFill(['status' => 'deactivated'])->save()],
        'deleted account' => [fn (Vehicle $vehicle, User $owner) => $owner->delete()],
    ]);

    it('lets an unlisted build be reached and shared by its link, and nowhere else', function () {
        config(['speedclub.public_pages.featured_slug' => $this->vehicle->canonicalSlug()]);
        $this->vehicle->forceFill(['visibility' => 'unlisted'])->save();
        $id = strtolower($this->vehicle->public_id);

        // The queue draws the picture (OgImages); the page names it from then on.
        (new DrawVehicleOgImage($this->vehicle->id))->handle(app(OgImages::class));
        $page = sec17Xpath((string) $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent());

        expect($page->query('//meta[@name="robots"]')->item(0)?->getAttribute('content'))->toBe('noindex')
            ->and($page->query('//meta[@property="og:image"]')->item(0)->getAttribute('content'))->toContain('/og/v/'.$this->vehicle->canonicalSlug().'-');

        $this->get('/c/'.$this->qr->code)->assertRedirect('/v/'.$this->vehicle->canonicalSlug());

        expect($this->get('/u/lukas.sc')->getContent())->not->toContain($id)
            ->and($this->get('/')->getContent())->not->toContain($id)
            ->and(app(SitemapWriter::class)->render())->not->toContain($id);
    });

    it('says noindex and stays out of the sitemap and the chosen build when the owner switched search engines off', function () {
        $this->owner->forceFill(['indexable' => false])->save();
        $id = strtolower($this->vehicle->public_id);

        foreach (['/v/'.$this->vehicle->canonicalSlug(), '/u/lukas.sc'] as $path) {
            expect(sec17Xpath((string) $this->get($path)->assertOk()->getContent())->query('//meta[@name="robots"]')->item(0)?->getAttribute('content'))->toBe('noindex');
        }

        $sitemap = app(SitemapWriter::class)->render();

        expect($sitemap)->not->toContain($id)->not->toContain('/u/lukas.sc')
            ->and($this->get('/')->getContent())->not->toContain($id);
    });
});

describe('a scan stores no IP and no identity', function () {
    it('changes nothing but one daily number, through the web, the app and a signed-in browser', function () {
        Exceptions::fake();
        $scanner = User::factory()->create(['username' => 'max.e46']);
        $cookie = sec17Cookie($scanner);
        $before = sec17Snapshot();

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.23'])->withHeader('User-Agent', SEC17_BROWSER);
        $this->get('/C/'.$this->qr->code)->assertRedirect();
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertOk();
        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/c/'.strtolower($this->qr->code))->assertRedirect();
        Sanctum::actingAs($scanner);
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertOk();

        $after = sec17Snapshot();
        $changed = array_keys(array_filter($after, fn (array $rows, string $table): bool => $rows !== ($before[$table] ?? []), ARRAY_FILTER_USE_BOTH));
        $dump = json_encode($after);

        expect($changed)->toBe(['qr_scan_daily'])
            ->and(array_keys((array) DB::table('qr_scan_daily')->first()))->toEqualCanonicalizing(['id', 'qr_code_id', 'day', 'count'])
            ->and((int) DB::table('qr_scan_daily')->sum('count'))->toBe(4)
            ->and($dump)->not->toContain('198.51.100.23')->not->toContain('SecAudit');

        Exceptions::assertNothingReported();
    });
});

describe('downloads are the owner\'s', function () {
    it('gives another member nothing of the code, by token or by cookie, and a guest neither', function (string $suffix) {
        FeatureFlag::query()->create(['key' => 'sig.qr_stats', 'enabled' => true]);
        $other = User::factory()->create();
        $url = '/api/v1/vehicles/'.$this->vehicle->id.$suffix;

        $guest = $this->getJson($url)->assertUnauthorized();

        $token = $this->withToken($other->createToken('phone', ['member'])->plainTextToken)->getJson($url)->assertForbidden();
        app('auth')->forgetGuards();
        $this->flushHeaders();

        $cookie = $this->withCookie(config()->string('session.cookie'), sec17Cookie($other))
            ->withHeaders(['Referer' => 'http://localhost:8080/app/qr/x', 'Accept' => 'application/json'])
            ->get($url)->assertForbidden();

        foreach ([$guest, $token, $cookie] as $response) {
            expect($response->getContent())->not->toContain($this->qr->code)
                ->and($response->headers->get('Content-Disposition'))->toBeNull()
                ->and($response->headers->get('Content-Type'))->toContain('application/json');
        }
    })->with(['/qr', '/qr/stats', '/qr.svg', '/qr.png', '/qr.pdf']);
});

describe('no open redirect', function () {
    it('redirects only to its own paths, whatever next, return or the address carries', function () {
        // With the redirect of signed-in members into the app on, as it is by default since VEH-01 exists there.
        config(['speedclub.public_pages.redirect_members_to_app' => true]);
        $slug = $this->vehicle->canonicalSlug();
        $id = strtolower($this->vehicle->public_id);
        $evil = 'next=https%3A%2F%2Fevil.example&return=%2F%2Fevil.example&returnTo=%2F%5Cevil.example';

        // A slash in a slug, encoded or not, matches no route at all.
        $this->get('/v/https%3A%2F%2Fevil.example-'.$id)->assertNotFound()->assertHeaderMissing('Location');
        $this->get('/v//evil.example-'.$id)->assertNotFound()->assertHeaderMissing('Location');

        $responses = [
            $this->get('/c/'.$this->qr->code.'?'.$evil),
            $this->get('/C/'.strtolower($this->qr->code).'?'.$evil),
            $this->get('/v/evil.example-'.$id.'?'.$evil),
            $this->get('/v/%5C%5Cevil.example-'.$id),
            $this->get('/u/Lukas.SC?'.$evil),
            $this->withCookie(config()->string('session.cookie'), sec17Cookie(User::factory()->create()))->get('/v/'.$slug.'?'.$evil),
        ];

        $origin = parse_url(url('/'));

        foreach ($responses as $response) {
            expect($response->status())->toBeIn([301, 302]);

            $location = parse_url((string) $response->headers->get('Location'));

            expect([$location['scheme'] ?? null, $location['host'] ?? null, $location['port'] ?? null])->toBe([$origin['scheme'], $origin['host'], $origin['port'] ?? null])
                ->and($location['path'])->toMatch('~^/(v|u|app/v)/[^/\\\\]+$~');
        }
    });

    it('sends the guest on with a next= that is always one of our own paths, even for hostile catalogue text', function () {
        $this->vehicle->forceFill(['make_text' => '//evil.example\\', 'model_text' => 'https://evil.example/@x'])->save();
        $html = (string) $this->get('/v/'.$this->vehicle->refresh()->canonicalSlug())->assertOk()->getContent();

        preg_match_all('~href="[^"]*[?&]next=([^"&]*)~', $html, $matches);

        expect($matches[1])->not->toBeEmpty();

        foreach ($matches[1] as $next) {
            $path = rawurldecode(html_entity_decode($next));

            expect($path)->toMatch('~^/v/[a-z0-9-]+$~');
        }
    });
});

describe('a foreign Host header', function () {
    afterEach(function () {
        SymfonyRequest::setTrustedHosts([]);
    });

    it('gets no public page, scan or redirect in production, and forwarding headers cannot move a link elsewhere', function () {
        // As production runs: without the debug page, which would print the rejected host back.
        config(['app.url' => 'https://speedclub.de', 'speedclub.trusted_hosts' => [], 'app.debug' => false]);
        app()->detectEnvironment(fn () => 'production');
        $slug = $this->vehicle->canonicalSlug();

        $paths = ['/', '/c/'.$this->qr->code, '/C/'.strtolower($this->qr->code), '/v/'.$slug, '/v/anders-'.strtolower($this->vehicle->public_id),
            '/u/lukas.sc', '/u/LUKAS.SC', '/impressum', '/robots.txt', '/sitemap.xml', '/.well-known/assetlinks.json'];

        foreach ($paths as $path) {
            $response = $this->get('https://evil.example'.$path);
            // Symfony keeps the hosts it has checked in a static list; each request of a real server starts without it.
            SymfonyRequest::setTrustedHosts([]);

            expect($response->status())->toBe(400, $path)
                ->and($response->headers->get('Location'))->toBeNull()
                ->and($response->getContent())->not->toContain('evil.example');
        }

        // No proxy is trusted, so what a client claims about host, scheme and port changes no address the server prints.
        $forwarded = ['X-Forwarded-Host' => 'evil.example', 'X-Forwarded-Proto' => 'http', 'X-Forwarded-Port' => '8443', 'Forwarded' => 'for=203.0.113.9;host=evil.example;proto=http'];
        $scan = $this->withHeaders($forwarded)->get('https://speedclub.de/c/'.$this->qr->code);
        SymfonyRequest::setTrustedHosts([]);
        $page = $this->withHeaders($forwarded)->get('https://speedclub.de/v/'.$slug)->assertOk();
        $og = sec17Xpath((string) $page->getContent());

        expect($scan->headers->get('Location'))->toBe('https://speedclub.de/v/'.$slug)
            ->and($page->getContent())->not->toContain('evil.example')->not->toContain('8443')
            ->and($og->query('//meta[@property="og:url"]')->item(0)->getAttribute('content'))->toBe('https://speedclub.de/v/'.$slug)
            ->and($og->query('//link[@rel="canonical"]')->item(0)->getAttribute('href'))->toBe('https://speedclub.de/v/'.$slug);
    });
});

describe('guests get no session and no cookie', function () {
    it('on every kind of public answer, the error states and a stale session cookie included', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);
        $live = sec17Vehicle($this->owner, 'Mazda', 'RX-7');
        $liveCode = app(QrCodes::class)->ensureActive($live)->code;
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => 'Text.']);

        $paths = ['/', '/v/'.$live->canonicalSlug(), '/u/lukas.sc', '/impressum', '/c/'.$liveCode, '/c/'.$this->qr->code, '/c/ZZZZZZZZ',
            '/v/gibt-es-nicht', '/u/gibt.es.nicht', '/agb', '/gibt-es-nicht', '/?qaState=error', '/robots.txt', '/sitemap.xml',
            '/.well-known/assetlinks.json', '/.well-known/apple-app-site-association'];

        foreach ($paths as $path) {
            $response = $this->get($path);

            expect($response->headers->getCookies())->toBe([], $path)
                ->and($response->headers->get('Set-Cookie'))->toBeNull();
        }

        $stale = $this->withUnencryptedCookies(['XSRF-TOKEN' => 'alt', config()->string('session.cookie') => str_repeat('z', 40)])->get('/v/'.$live->canonicalSlug())->assertOk();

        config(['speedclub.rate_limits.qr.max' => 0]);
        RateLimits::register();
        $limited = $this->get('/c/'.$liveCode)->assertStatus(429);

        expect($stale->headers->getCookies())->toBe([])
            ->and($limited->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->count())->toBe(0);
    });
});

describe('well-known and machine files', function () {
    it('expose nothing but public app identifiers, and no configured secret appears in any public file', function () {
        config([
            'speedclub.mobile.android_cert_sha256' => str_repeat('AB', 32),
            'speedclub.mobile.ios_team_id' => 'ABCDE12345',
            'speedclub.mobile.ios_bundle_id' => 'de.speedclub.app',
        ]);

        $links = $this->get('/.well-known/assetlinks.json')->assertOk()->json();
        $aasa = $this->get('/.well-known/apple-app-site-association')->assertOk()->json();

        expect(array_keys($links[0]))->toBe(['relation', 'target'])
            ->and(array_keys($links[0]['target']))->toBe(['namespace', 'package_name', 'sha256_cert_fingerprints'])
            ->and(array_keys($aasa))->toBe(['applinks', 'webcredentials'])
            ->and($aasa['webcredentials'])->toBe(['apps' => ['ABCDE12345.de.speedclub.app']])
            ->and(array_keys($aasa['applinks']['details'][0]))->toBe(['appIDs', 'components']);

        $secrets = collect(Arr::dot(config()->all()))
            ->filter(fn (mixed $value, string $key): bool => is_string($value) && strlen($value) >= 12 && ! str_contains($value, '\\')
                && preg_match('~(^|[._])(key|secret|password|pass|token|private_key|dsn|salt|credentials?)($|[._])~i', $key) === 1)
            ->values();

        expect($secrets)->toContain(config('app.key'));

        foreach (['/robots.txt', '/sitemap.xml', '/.well-known/assetlinks.json', '/.well-known/apple-app-site-association', '/', '/v/'.$this->vehicle->canonicalSlug()] as $path) {
            $body = (string) $this->get($path)->getContent();

            foreach ($secrets as $secret) {
                expect(str_contains($body, $secret))->toBeFalse($path.' holds the value of a secret config key');
            }
        }
    });
});

describe('no directory listing of the public disk', function () {
    it('turns listing off at the top of public/.htaccess, not only where mod_negotiation happens to be loaded', function () {
        $htaccess = (string) file_get_contents(public_path('.htaccess'));

        // A block at column 0 is nested in nothing. Reproduced with a second Apache that loads mod_autoindex but not
        // mod_negotiation under Options +Indexes: the old file listed /storage/og/v, this one answers 403.
        expect(preg_match('~^<IfModule mod_autoindex\.c>\R[ \t]+Options -Indexes\R</IfModule>\r?$~m', $htaccess))->toBe(1);
    });
});
