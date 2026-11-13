<?php

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Enums\Visibility;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use App\Services\PublicPages\DrawVehicleOgImage;
use App\Services\PublicPages\OgImageCanvas;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use App\Support\DesignTokens;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * Link previews (WhatsApp, iMessage, Facebook, X, Telegram, Slack): every shareable page carries complete, well-formed tags in its
 * head, and every og:image answers a real JPEG of the stated size below 300 KB, on HTTPS, without redirect or cookie.
 */
const SOCIAL_SITE = 'https://speedclub.test';

beforeEach(function () {
    Storage::fake('public');
    config(['app.url' => SOCIAL_SITE]);
    // A German phone; the test client asks for English otherwise.
    $this->withHeader('Accept-Language', 'de-DE,de;q=0.9');
    seedModSchema();

    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz', 'city' => 'Stuttgart', 'email' => 'lukas.privat@example.de']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R R34', 'model_year' => 2002, 'description' => null]);
    $this->photo = $this->vehicle->media()->firstOrFail();
    socialVariants($this->photo);
    VehicleSpec::factory()->create(['vehicle_id' => $this->vehicle->id, 'power_value' => 500, 'power_unit' => 'ps', 'power_ps' => 500, 'torque_nm' => 540]);
    modIn($this->vehicle, 'suspension', ['type' => 'coilover'], ['title' => 'KW V3', 'status' => 'installed', 'cost_cents' => 312_345, 'cost_public' => false]);
    modIn($this->vehicle, 'exhaust', [], ['title' => 'HKS Super Turbo Muffler', 'status' => 'installed']);
    modIn($this->vehicle, 'exhaust', [], ['title' => 'Tomei Expreme Ti', 'status' => 'planned']);
    $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
    $this->slug = Vehicle::query()->findOrFail($this->vehicle->id)->canonicalSlug();
});

/**
 * Real-looking upload variants: noise, the worst case for the JPEG size.
 */
function socialVariants(Media $media): void
{
    $image = imagecreatetruecolor(1600, 1067);

    for ($y = 0; $y < 1067; $y += 2) {
        for ($x = 0; $x < 1600; $x += 2) {
            imagefilledrectangle($image, $x, $y, $x + 1, $y + 1, (int) imagecolorallocate($image, random_int(0, 255), random_int(0, 255), random_int(0, 255)));
        }
    }

    ob_start();
    imagewebp($image, null, 90);
    $bytes = (string) ob_get_clean();

    foreach ($media->getAttribute('variants') as $path) {
        Storage::disk('public')->put($path, $bytes);
    }
}

/**
 * The <head> as the Facebook sharing debugger reads it: meta tags in document order.
 *
 * @return list<array{0: string, 1: string}> [property or name, content]
 */
function headMeta(string $html): array
{
    $head = substr($html, 0, (int) strpos($html, '</head>'));
    preg_match_all('~<meta\s+(?:property|name)="([^"]+)"(?:\s+media="[^"]*")?\s+content="([^"]*)"\s*/?>~', $head, $matches, PREG_SET_ORDER);

    return array_map(fn (array $match): array => [$match[1], html_entity_decode($match[2], ENT_QUOTES | ENT_HTML5)], $matches);
}

function metaOnce(string $html, string $key): string
{
    $values = array_values(array_map(fn (array $tag): string => $tag[1], array_filter(headMeta($html), fn (array $tag): bool => $tag[0] === $key)));

    expect($values)->toHaveCount(1, "$key once");

    return $values[0];
}

/**
 * og:image structured properties belong to the og:image before them, as the Open Graph protocol says.
 *
 * @return list<array<string, list<string>>>
 */
function imageGroups(string $html): array
{
    $groups = [];

    foreach (headMeta($html) as [$key, $value]) {
        if ($key === 'og:image') {
            $groups[] = ['url' => [$value]];
        } elseif (str_starts_with($key, 'og:image:')) {
            expect($groups)->not->toBe([], "$key before any og:image");
            $groups[count($groups) - 1][substr($key, 9)][] = $value;
        }
    }

    return $groups;
}

/**
 * Fetches an og:image like a crawler: one request, no redirect followed.
 *
 * @return array{0: string, 1: TestResponse}
 */
function fetchCard(string $url, int $width, int $height): array
{
    expect($url)->toStartWith(SOCIAL_SITE.'/og/');

    $response = test()->withHeader('User-Agent', 'facebookexternalhit/1.1')->get($url);
    $response->assertOk()->assertHeader('Content-Type', 'image/jpeg');

    $bytes = (string) $response->getContent();
    [$w, $h, $type] = getimagesizefromstring($bytes) ?: [0, 0, 0];

    expect([$w, $h, $type])->toBe([$width, $height, IMAGETYPE_JPEG])
        ->and(strlen($bytes))->toBeLessThan(300_000)
        ->and($response->headers->getCookies())->toBe([])
        ->and(str_contains($bytes, 'Exif'))->toBeFalse();

    return [$bytes, $response];
}

function assertSharePage(string $html, string $type): void
{
    foreach (['og:site_name', 'og:type', 'og:title', 'og:description', 'og:url', 'og:locale', 'og:locale:alternate', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt', 'description'] as $key) {
        metaOnce($html, $key);
    }

    expect(metaOnce($html, 'og:site_name'))->toBe('SPEED CLUB')
        ->and(metaOnce($html, 'og:type'))->toBe($type)
        ->and(metaOnce($html, 'og:url'))->toStartWith(SOCIAL_SITE)
        ->and(metaOnce($html, 'twitter:card'))->toBe('summary_large_image')
        ->and(metaOnce($html, 'twitter:title'))->toBe(metaOnce($html, 'og:title'))
        ->and(mb_strlen(metaOnce($html, 'description')))->toBeLessThanOrEqual(155)
        ->and(metaOnce($html, 'og:description'))->toBe(metaOnce($html, 'description'))
        ->and($html)->toMatch('~<link rel="canonical" href="'.preg_quote(SOCIAL_SITE, '~').'[^"]*">~')
        ->and($html)->toContain('<link rel="manifest"')
        ->and($html)->toContain('<link rel="apple-touch-icon"')
        ->and($html)->toContain('name="theme-color"');

    // The preview comes before the inlined stylesheet and every script.
    $head = substr($html, 0, (int) strpos($html, '</head>'));
    $lastMeta = strrpos($head, 'name="twitter:image:alt"');
    expect($lastMeta)->toBeLessThan(strpos($head, '<style') === false ? PHP_INT_MAX : strpos($head, '<style'))
        ->and($lastMeta)->toBeLessThan(strpos($head, '<script') === false ? PHP_INT_MAX : strpos($head, '<script'));

    $groups = imageGroups($html);

    expect($groups)->toHaveCount(2)
        ->and(metaOnce($html, 'twitter:image'))->toBe($groups[0]['url'][0]);

    foreach ([[1200, 630], [1080, 1080]] as $index => [$width, $height]) {
        $group = $groups[$index];

        foreach (['secure_url', 'type', 'width', 'height', 'alt'] as $key) {
            expect($group[$key] ?? [])->toHaveCount(1, "og:image:$key once in image $index");
        }

        expect($group['url'][0])->toStartWith('https://')
            ->and($group['secure_url'][0])->toBe($group['url'][0])
            ->and($group['type'][0])->toBe('image/jpeg')
            ->and([$group['width'][0], $group['height'][0]])->toBe([(string) $width, (string) $height]);

        fetchCard($group['url'][0], $width, $height);
    }
}

/**
 * @return list<array<string, mixed>>
 */
function jsonLd(string $html): array
{
    preg_match_all('~<script type="application/ld\+json"[^>]*>(.*?)</script>~s', $html, $blocks);

    return array_map(fn (string $json): array => json_decode($json, true, 32, JSON_THROW_ON_ERROR), $blocks[1]);
}

function privateFreeHead(string $html): void
{
    $head = substr($html, 0, (int) strpos($html, '</head>'));
    $meta = implode("\n", array_map(fn (array $tag): string => $tag[1], headMeta($html)));
    $data = (string) json_encode(jsonLd($html));

    foreach ([$meta, $data] as $text) {
        // No e-mail, no private cost, nothing like a VIN (17 characters, no I, O or Q) or a German plate.
        expect($text)->not->toContain('lukas.privat@example.de')
            ->not->toContain('3.123')->not->toContain('3123')
            ->not->toMatch('~\b[A-HJ-NPR-Z0-9]{17}\b~')
            ->not->toMatch('~\b[A-ZÄÖÜ]{1,3}-[A-Z]{1,2} \d{1,4}[EH]?\b~u');
    }

    expect($head)->not->toContain('vehicleIdentificationNumber');
}

describe('the vehicle page', function () {
    it('carries a complete preview: title, specific German description, both cards, Car in JSON-LD', function () {
        $html = (string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->assertOk()->getContent();

        assertSharePage($html, 'article');
        privateFreeHead($html);

        expect(metaOnce($html, 'og:title'))->toBe('Nissan Skyline GT-R R34 – Build von @lukas.sc | SPEED CLUB')
            ->and(metaOnce($html, 'description'))->toBe("500\u{00A0}PS · 540\u{00A0}Nm · 2 Mods: KW V3, HKS Super Turbo Muffler. Sieh dir den kompletten Build an.")
            ->and(metaOnce($html, 'og:locale'))->toBe('de_DE')
            ->and(metaOnce($html, 'og:locale:alternate'))->toBe('en_GB')
            ->and(metaOnce($html, 'og:url'))->toBe(SOCIAL_SITE.'/v/'.$this->slug)
            ->and(imageGroups($html)[0]['url'][0])->toMatch('~^'.preg_quote(SOCIAL_SITE, '~').'/og/v/'.$this->slug.'-[0-9a-f]{16}\.jpg$~')
            ->and(imageGroups($html)[1]['url'][0])->toMatch('~-[0-9a-f]{16}-square\.jpg$~');

        $car = collect(jsonLd($html))->firstWhere('@type', 'Car');

        expect($car['name'])->toBe('Nissan Skyline GT-R R34')
            ->and($car['url'])->toBe(SOCIAL_SITE.'/v/'.$this->slug)
            ->and($car['image'])->toHaveCount(2)
            ->and($car['vehicleEngine']['enginePower']['value'])->toBe(500)
            ->and($car['vehicleModelDate'])->toBe('2002');
    });

    it('speaks English with ?lang=en, and swaps the locales', function () {
        $html = (string) $this->get(SOCIAL_SITE.'/v/'.$this->slug.'?lang=en')->assertOk()->getContent();

        expect(metaOnce($html, 'og:locale'))->toBe('en_GB')
            ->and(metaOnce($html, 'og:locale:alternate'))->toBe('de_DE')
            ->and(metaOnce($html, 'og:title'))->toBe('Nissan Skyline GT-R R34 – build by @lukas.sc | SPEED CLUB')
            ->and(metaOnce($html, 'description'))->toEndWith('See the full build.');
    });

    it('previews in the club\'s language for a fetcher that asks for English for itself, unless the link says ?lang=', function () {
        $fetcher = fn (string $path): string => (string) $this->withHeaders(['User-Agent' => 'facebookexternalhit/1.1', 'Accept-Language' => 'en-US,en;q=0.9'])->get(SOCIAL_SITE.$path)->getContent();

        expect(metaOnce($fetcher('/v/'.$this->slug), 'og:locale'))->toBe('de_DE')
            ->and(metaOnce($fetcher('/v/'.$this->slug.'?lang=en'), 'og:locale'))->toBe('en_GB');
    });

    it('puts the figures before an owner text that says something, and skips one that does not', function () {
        $this->vehicle->forceFill(['description' => 'Skyline GT-R V-Spec II aus Japan, 2021 über Yokohama importiert und seitdem Schritt für Schritt aufgebaut, mit viel Liebe zum Detail.'])->save();
        $long = metaOnce((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent(), 'description');

        $this->vehicle->forceFill(['description' => 'Mein Auto.'])->save();
        $short = metaOnce((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent(), 'description');

        expect($long)->toStartWith("500\u{00A0}PS · 540\u{00A0}Nm · 2 Mods – Skyline GT-R V-Spec II")
            ->and(mb_strlen($long))->toBeLessThanOrEqual(155)
            ->and($short)->toContain('KW V3')->not->toContain('Mein Auto');
    });

    it('lists as many mods as fit into 155 characters and marks the rest', function () {
        foreach (range(1, 12) as $n) {
            modIn($this->vehicle, 'interior', [], ['title' => "Bride Zeta III Sitz Nummer $n", 'status' => 'installed']);
        }

        $description = metaOnce((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent(), 'description');

        expect(mb_strlen($description))->toBeLessThanOrEqual(155)
            ->and($description)->toContain('14 Mods: KW V3')
            ->and($description)->toContain(' … Sieh dir den kompletten Build an.');
    });

    it('names no owner who hides on the pages a code leads to, neither in the tags nor on the card', function () {
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();

        $html = (string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent();

        expect(metaOnce($html, 'og:title'))->toBe('Nissan Skyline GT-R R34 | SPEED CLUB')
            ->and($html)->not->toContain('@lukas.sc');
    });
});

describe('the cards behind og:image', function () {
    it('draws the vehicle card on the first crawler request, while the queue has not run yet', function () {
        Queue::fake();
        $html = (string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent();
        Queue::assertPushed(DrawVehicleOgImage::class);

        expect(Storage::disk('public')->files('og/v'))->toBe([]);

        [$bytes, $response] = fetchCard(imageGroups($html)[0]['url'][0], 1200, 630);
        $path = (string) Vehicle::query()->whereKey($this->vehicle->id)->value('og_image_path');

        // Both formats drawn and kept, and the answer is the stored file, not the brand card.
        expect($path)->toMatch('~^og/v/[0-9a-f]{40}\.jpg$~')
            ->and(Storage::disk('public')->get($path))->toBe($bytes)
            ->and(Storage::disk('public')->exists(substr($path, 0, -4).'-square.jpg'))->toBeTrue()
            ->and($response->headers->get('Cache-Control'))->toContain('immutable')->toContain('public')
            ->and((int) preg_replace('~.*max-age=(\d+).*~', '$1', (string) $response->headers->get('Cache-Control')))->toBeGreaterThanOrEqual(604800)
            ->and($response->headers->get('ETag'))->not->toBeNull();

        // The second crawler gets the same file, and a revalidation is a 304.
        $again = $this->get(imageGroups($html)[0]['url'][0])->assertOk();
        expect($again->getContent())->toBe($bytes);
        $this->withHeader('If-None-Match', (string) $response->headers->get('ETag'))->get(imageGroups($html)[0]['url'][0])->assertStatus(304);
    });

    it('answers an outdated address with today\'s card, cached briefly, never with a redirect', function () {
        $old = SOCIAL_SITE.'/og/v/'.$this->slug.'-0123456789abcdef.jpg';

        $response = $this->get($old)->assertOk()->assertHeader('Content-Type', 'image/jpeg');

        expect($response->headers->get('Cache-Control'))->not->toContain('immutable')->toContain('max-age=3600');
    });

    it('changes the address when the build changes', function () {
        $before = imageGroups((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent())[0]['url'][0];
        VehicleSpec::query()->whereKey($this->vehicle->id)->update(['power_value' => 520, 'power_ps' => 520]);
        $after = imageGroups((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent())[0]['url'][0];

        expect($after)->not->toBe($before);
    });

    it('answers 404 for a build that is taken down, and its files are gone', function () {
        $url = imageGroups((string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent())[0]['url'][0];
        fetchCard($url, 1200, 630);
        $path = (string) Vehicle::query()->whereKey($this->vehicle->id)->value('og_image_path');

        app(ChangeVehicleVisibility::class)->handle(Vehicle::query()->findOrFail($this->vehicle->id), Visibility::Private);

        $this->get($url)->assertNotFound();
        $this->get(str_replace('.jpg', '-square.jpg', $url))->assertNotFound();
        Storage::disk('public')->assertMissing($path);
        Storage::disk('public')->assertMissing(substr($path, 0, -4).'-square.jpg');
    });

    it('answers 404 for addresses that name nothing', function (string $path) {
        $this->get(SOCIAL_SITE.$path)->assertNotFound();
    })->with([
        'unknown vehicle' => '/og/v/nissan-skyline-00000000-0123456789abcdef.jpg',
        'unknown member' => '/og/u/niemand-0123456789abcdef.jpg',
        'no hash' => '/og/v/nissan-skyline.jpg',
        'a traversal' => '/og/v/..%2F..%2F.env-0123456789abcdef.jpg',
        'not a card' => '/og/site-0123456789abcdef.png',
    ]);

    it('keeps every card below 300 KB, even for a photo of pure noise', function () {
        $canvas = app(OgImageCanvas::class);
        $photo = (string) Storage::disk('public')->get($this->photo->getAttribute('variants')['1600']);

        foreach (OgImageCanvas::FORMATS as $format => [$width, $height]) {
            $jpeg = $canvas->vehicle($photo, 0.5, 0.5, 'NISSAN', 'Skyline GT-R R34', [['value' => '500', 'unit' => 'PS', 'label' => 'Leistung']], '@lukas.sc', null, $format);

            expect(strlen($jpeg))->toBeLessThan(300_000)
                ->and(array_slice(getimagesizefromstring($jpeg) ?: [], 0, 2))->toBe([$width, $height]);
        }
    });
});

describe('the member page', function () {
    it('carries a complete profile preview with the builds and a ProfilePage', function () {
        $html = (string) $this->get(SOCIAL_SITE.'/u/lukas.sc')->assertOk()->getContent();

        assertSharePage($html, 'profile');
        privateFreeHead($html);

        expect(metaOnce($html, 'og:title'))->toBe('Lukas Scholz (@lukas.sc) | SPEED CLUB')
            ->and(metaOnce($html, 'description'))->toBe('Lukas Scholz aus Stuttgart · 1 Build: Nissan Skyline GT-R R34. Sieh dir die Garage an.');

        $page = collect(jsonLd($html))->firstWhere('@type', 'ProfilePage');

        expect($page['mainEntity']['@type'])->toBe('Person')
            ->and($page['mainEntity']['alternateName'])->toBe('@lukas.sc')
            ->and($page['mainEntity']['homeLocation']['name'])->toBe('Stuttgart');
    });
});

describe('the landing page and the brand card', function () {
    it('carries the brand card in both formats and Organization plus WebSite', function () {
        $html = (string) $this->get(SOCIAL_SITE.'/')->assertOk()->getContent();

        assertSharePage($html, 'website');

        expect(imageGroups($html)[0]['url'][0])->toMatch('~/og/site-[0-9a-f]{16}\.jpg$~')
            ->and(collect(jsonLd($html))->pluck('@type')->all())->toContain('Organization')->toContain('WebSite');
    });

    it('is the card of a vehicle without a usable photo', function () {
        $this->photo->forceFill(['moderation_status' => 'rejected'])->save();

        $html = (string) $this->get(SOCIAL_SITE.'/v/'.$this->slug)->getContent();

        expect(imageGroups($html)[0]['url'][0])->toBe(app(OgImages::class)->defaultCards()['landscape']);
    });
});

describe('crawlers', function () {
    it('reach /c/{code} with exactly one redirect, to the canonical HTTPS page, which answers 200', function () {
        $response = $this->withHeader('User-Agent', 'WhatsApp/2.23.20.0 A')->get(SOCIAL_SITE.'/c/'.$this->qr->code);

        $response->assertStatus(302)->assertHeader('Location', SOCIAL_SITE.'/v/'.$this->slug);
        $this->withHeader('User-Agent', 'WhatsApp/2.23.20.0 A')->get((string) $response->headers->get('Location'))->assertOk();
    });

    it('get every preview page with 200 and no redirect, whatever they call themselves', function (string $agent) {
        foreach (['/', '/v/'.$this->slug, '/u/lukas.sc'] as $path) {
            $response = $this->withHeader('User-Agent', $agent)->get(SOCIAL_SITE.$path);

            $response->assertOk();
            expect($response->headers->getCookies())->toBe([]);
        }
    })->with([
        'WhatsApp' => 'WhatsApp/2.23.20.0 A',
        'Facebook' => 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'X' => 'Twitterbot/1.0',
        'Telegram' => 'TelegramBot (like TwitterBot)',
        'Slack' => 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
        'iMessage' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
    ]);

    it('read a robots.txt that opens the shared pages and their cards in both modes, and keeps /app and /admin out', function (bool $indexing) {
        config(['speedclub.public_pages.allow_indexing' => $indexing]);

        $robots = (string) $this->get(SOCIAL_SITE.'/robots.txt')->assertOk()->getContent();
        [$previews] = explode("\n\n", substr($robots, (int) strpos($robots, 'User-agent: Twitterbot')));

        expect($previews)->toContain('User-agent: facebookexternalhit')
            ->toContain('User-agent: WhatsApp')
            ->toContain('Allow: /v/')->toContain('Allow: /u/')->toContain('Allow: /og/')->toContain('Allow: /c/');

        if ($indexing) {
            // M4.16: the event, business and brand pages join the crawled paths (each says noindex where its subject asks).
            expect($robots)->toStartWith("User-agent: *\nAllow: /v/\nAllow: /u/\nAllow: /e/\nAllow: /b/\nAllow: /brands/\nAllow: /og/\n")
                ->toContain('Disallow: /app/')->toContain('Disallow: /admin')
                ->and(explode("\n", $previews))->not->toContain('Disallow: /');
        } else {
            expect($robots)->toEndWith("User-agent: *\nDisallow: /\n")
                ->and(explode("\n", $previews))->toContain('Disallow: /');
        }
    })->with(['production' => true, 'staging' => false]);
});

describe('/app links', function () {
    beforeEach(function () {
        $this->index = tempnam(sys_get_temp_dir(), 'spa');
        file_put_contents($this->index, '<!doctype html><html><head><meta charset="utf-8" /><title>SPEED CLUB</title></head><body><div id="root"></div></body></html>');
        config(['speedclub.spa.index' => $this->index]);
    });

    afterEach(function () {
        @unlink($this->index);
    });

    it('preview like the public page, canonical to it', function (string $path, string $type) {
        $html = (string) $this->get(SOCIAL_SITE.str_replace('{slug}', $this->slug, $path))->assertOk()->getContent();

        expect(substr_count($html, '<title>'))->toBe(1)
            ->and($html)->toContain('<div id="root"></div>')
            ->and($html)->toContain('<meta name="robots" content="noindex">')
            ->and(metaOnce($html, 'og:type'))->toBe($type)
            ->and(metaOnce($html, 'og:url'))->toBe(SOCIAL_SITE.str_replace(['/app', '{slug}'], ['', $this->slug], $path))
            ->and(imageGroups($html))->toHaveCount(2);

        fetchCard(imageGroups($html)[0]['url'][0], 1200, 630);
    })->with([
        'vehicle' => ['/app/v/{slug}', 'article'],
        'member' => ['/app/u/lukas.sc', 'profile'],
    ]);

    it('stay plain for anything a guest may not see, and for every other app address', function (string $path) {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();

        $response = $this->get(SOCIAL_SITE.str_replace('{slug}', $this->slug, $path))->assertOk();

        // The file itself, untouched.
        expect($response->baseResponse)->toBeInstanceOf(BinaryFileResponse::class)
            ->and($response->baseResponse->getFile()->getPathname())->toBe($this->index);
    })->with(['private vehicle' => '/app/v/{slug}', 'garage' => '/app/garage', 'unknown member' => '/app/u/niemand']);
});

it('has a web manifest in the token colours', function () {
    $manifest = json_decode((string) file_get_contents(public_path('site.webmanifest')), true, 8, JSON_THROW_ON_ERROR);

    expect($manifest['name'])->toBe('SPEED CLUB')
        ->and($manifest['theme_color'])->toBe(DesignTokens::color('bg-canvas'))
        ->and($manifest['background_color'])->toBe(DesignTokens::color('bg-canvas'))
        ->and(collect($manifest['icons'])->pluck('src')->all())->each(fn ($src) => $src->toBeString());

    foreach ($manifest['icons'] as $icon) {
        expect(public_path(ltrim($icon['src'], '/')))->toBeFile();
    }
});
