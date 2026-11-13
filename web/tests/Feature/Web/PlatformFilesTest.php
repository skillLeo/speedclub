<?php

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Actions\Garage\DeleteVehicle;
use App\Actions\Me\UpdateSettings;
use App\Enums\LegalDocumentKey;
use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\LegalDocument;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

const CERT_LOWER = 'ae6e9844fccec00e4f25641aca1a2f1e9ffec4d05023bc34727598291876749f';
const CERT_COLONS = 'AE:6E:98:44:FC:CE:C0:0E:4F:25:64:1A:CA:1A:2F:1E:9F:FE:C4:D0:50:23:BC:34:72:75:98:29:18:76:74:9F';

describe('robots.txt', function () {
    it('keeps crawlers off the app, the admin, the API and the resolver, and names the sitemap', function () {
        config(['speedclub.public_pages.allow_indexing' => true, 'app.url' => 'https://speedclub.de']);

        $response = $this->get('/robots.txt')->assertOk();

        expect($response->headers->get('Content-Type'))->toBe('text/plain; charset=UTF-8')
            ->and($response->getContent())
            ->toContain('Disallow: /app/')
            ->toContain('Disallow: /admin')
            ->toContain('Disallow: /api/')
            ->toContain('Disallow: /C/')
            ->toContain('Sitemap: https://speedclub.de/sitemap.xml')
            ->and($response->headers->getCookies())->toBe([]);
    });

    it('forbids everything to search engines where indexing is off, and opens only shared pages to link previews', function () {
        config(['speedclub.public_pages.allow_indexing' => false]);

        $robots = (string) $this->get('/robots.txt')->getContent();
        [$previews, $everybody] = explode("\n\n", $robots);

        expect($everybody)->toBe("User-agent: *\nDisallow: /\n")
            ->and($previews)->toStartWith("User-agent: Twitterbot\n")->toEndWith("\nDisallow: /")
            ->toContain("Allow: /v/\n")->toContain("Allow: /og/\n")
            ->not->toContain('Allow: /app/garage')->not->toContain('Allow: /admin')
            ->and($robots)->not->toContain('Sitemap:');
    });

    it('is not shadowed by a static file', function () {
        expect(public_path('robots.txt'))->not->toBeFile();
    });
});

describe('sitemap.xml', function () {
    beforeEach(function () {
        Storage::fake('local');
        config(['app.url' => 'https://speedclub.de']);
    });

    /**
     * @return list<string>
     */
    function sitemapUrls(string $xml): array
    {
        $document = new DOMDocument;
        expect($document->loadXML($xml))->toBeTrue();

        $urls = [];

        foreach ($document->getElementsByTagName('loc') as $loc) {
            $urls[] = $loc->textContent;
        }

        return $urls;
    }

    it('holds public vehicles and members who allow search engines, and nothing else', function () {
        $public = publishedVehicle(User::factory()->create(['username' => 'oeffentlich']));
        $private = publishedVehicle($public->owner, ['visibility' => 'private']);
        $unlisted = publishedVehicle($public->owner, ['visibility' => 'unlisted']);
        $draft = Vehicle::factory()->create(['owner_id' => $public->owner_id]);
        $deleted = publishedVehicle($public->owner);
        $deleted->delete();

        $noindexOwner = User::factory()->create(['username' => 'keine.suche', 'indexable' => false]);
        $noindexVehicle = publishedVehicle($noindexOwner);
        $suspendedOwner = User::factory()->suspended()->create(['username' => 'gesperrt']);
        $suspendedVehicle = publishedVehicle($suspendedOwner);
        $unverifiedOwner = User::factory()->unverified()->create(['username' => 'unbestaetigt']);
        $unverifiedVehicle = publishedVehicle($unverifiedOwner);
        $deactivated = User::factory()->deactivated()->create(['username' => 'weg']);

        $urls = sitemapUrls($this->get('/sitemap.xml')->assertOk()->getContent());
        $base = 'https://speedclub.de';

        expect($urls)->toContain($base.'/')
            ->toContain($base.'/v/'.$public->canonicalSlug())
            ->toContain($base.'/u/oeffentlich');

        foreach ([$private, $unlisted, $draft, $deleted, $noindexVehicle, $suspendedVehicle, $unverifiedVehicle] as $hidden) {
            expect($urls)->not->toContain($base.'/v/'.$hidden->canonicalSlug());
        }

        foreach (['keine.suche', 'gesperrt', 'unbestaetigt', 'weg'] as $name) {
            expect($urls)->not->toContain($base.'/u/'.$name);
        }

        expect($deactivated)->not->toBeNull();
    });

    it('lists only published legal pages', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de']);
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'published_at' => null]);

        $urls = sitemapUrls($this->get('/sitemap.xml')->getContent());

        expect($urls)->toContain('https://speedclub.de/impressum')
            ->not->toContain('https://speedclub.de/agb');
    });

    it('answers XML with a modification date', function () {
        publishedVehicle();

        $response = $this->get('/sitemap.xml')->assertOk();

        expect($response->headers->get('Content-Type'))->toBe('application/xml; charset=UTF-8')
            ->and($response->getContent())->toContain('<lastmod>')
            ->toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
            ->and($response->headers->getCookies())->toBe([]);
    });

    it('reads what the daily command wrote, until the next run', function () {
        $first = publishedVehicle();

        Artisan::call('sitemap:generate');

        Storage::disk('local')->assertExists(config('speedclub.public_pages.sitemap_path'));

        $later = publishedVehicle();
        $urls = sitemapUrls($this->get('/sitemap.xml')->getContent());

        expect($urls)->toContain('https://speedclub.de/v/'.$first->canonicalSlug())
            ->not->toContain('https://speedclub.de/v/'.$later->canonicalSlug());

        Artisan::call('sitemap:generate');

        expect(sitemapUrls($this->get('/sitemap.xml')->getContent()))->toContain('https://speedclub.de/v/'.$later->canonicalSlug());
    });

    it('publishes no moment of a member, so a sign-in shows nowhere', function () {
        $this->travelTo('2026-03-01 10:00:00');
        $member = User::factory()->create(['username' => 'max.e46', 'email' => 'max@example.de']);
        publishedVehicle($member);
        $before = app(SitemapWriter::class)->render();

        $this->travelTo('2026-11-03 06:12:34');
        $this->postJson('/api/v1/auth/login', ['email' => 'max@example.de', 'password' => 'password', 'device_name' => 'Pixel'])->assertOk();

        expect(User::query()->findOrFail($member->id)->updated_at->toAtomString())->toBe('2026-11-03T06:12:34+00:00');

        $xml = app(SitemapWriter::class)->render();
        preg_match('~<url><loc>[^<]*/u/max\.e46</loc>(.*?)</url>~', $xml, $entry);

        expect($entry)->not->toBeEmpty()
            ->and($entry[1])->toBe('')
            ->and($xml)->not->toContain('2026-11-03T06:12:34')
            ->and($xml)->toBe($before);
    });

    it('lists members oldest first, not by their last change', function () {
        $this->travelTo('2026-01-01 10:00:00');
        User::factory()->create(['username' => 'erster']);
        $this->travelTo('2026-02-01 10:00:00');
        User::factory()->create(['username' => 'zweiter']);
        $this->travelTo('2026-03-01 10:00:00');
        User::query()->where('username', 'erster')->firstOrFail()->forceFill(['city' => 'Köln'])->save();

        $members = array_values(array_filter(sitemapUrls(app(SitemapWriter::class)->render()), fn (string $url): bool => str_contains($url, '/u/')));

        expect($members)->toBe(['https://speedclub.de/u/erster', 'https://speedclub.de/u/zweiter']);
    });

    it('stays inside the limit of one sitemap file', function () {
        config(['speedclub.public_pages.sitemap_max_urls' => 2]);
        publishedVehicle();
        publishedVehicle();

        expect(sitemapUrls(app(SitemapWriter::class)->render()))->toHaveCount(2);
    });

    it('drops a vehicle that leaves the public at once, not with the night', function (Closure $leave) {
        $owner = User::factory()->create(['username' => 'bleibt']);
        $leaving = publishedVehicle($owner);
        $staying = publishedVehicle($owner);
        app(SitemapWriter::class)->write();

        expect($this->get('/sitemap.xml')->getContent())->toContain(strtolower($leaving->public_id));

        $leave($leaving);

        expect($this->get('/sitemap.xml')->getContent())
            ->not->toContain(strtolower($leaving->public_id))
            ->toContain(strtolower($staying->public_id))
            ->toContain('/u/bleibt');
    })->with([
        'private' => [fn (Vehicle $vehicle) => app(ChangeVehicleVisibility::class)->handle($vehicle, Visibility::Private)],
        'unlisted' => [fn (Vehicle $vehicle) => app(ChangeVehicleVisibility::class)->handle($vehicle, Visibility::Unlisted)],
        'deleted' => [fn (Vehicle $vehicle) => app(DeleteVehicle::class)->handle($vehicle->owner, $vehicle)],
    ]);

    it('drops an owner who switched search engines off at once, with the vehicles', function () {
        $owner = User::factory()->create(['username' => 'keine.suche']);
        $vehicle = publishedVehicle($owner);
        app(SitemapWriter::class)->write();

        app(UpdateSettings::class)->handle($owner, ['indexable' => false]);

        expect($this->get('/sitemap.xml')->getContent())
            ->not->toContain('/u/keine.suche')
            ->not->toContain(strtolower($vehicle->public_id));
    });

    it('keeps the written file when nothing left the public', function (Closure $change) {
        $owner = User::factory()->create();
        $vehicle = publishedVehicle($owner, ['visibility' => 'unlisted']);
        app(SitemapWriter::class)->write();

        $change($vehicle, $owner);

        Storage::disk('local')->assertExists(config()->string('speedclub.public_pages.sitemap_path'));
    })->with([
        'unlisted to public, which may wait for the night' => [fn (Vehicle $vehicle) => app(ChangeVehicleVisibility::class)->handle($vehicle, Visibility::Public)],
        'another setting' => [fn (Vehicle $vehicle, User $owner) => app(UpdateSettings::class)->handle($owner, ['show_owner_on_qr' => false])],
        'search engines on' => [fn (Vehicle $vehicle, User $owner) => app(UpdateSettings::class)->handle($owner, ['indexable' => true])],
    ]);

    it('is throttled, since a forgotten file is rendered from the whole table', function () {
        config(['speedclub.rate_limits.public_read.max' => 1]);
        RateLimits::register();

        $this->get('/sitemap.xml')->assertOk();
        $this->get('/sitemap.xml')->assertStatus(429)->assertHeader('Retry-After');
    });
});

describe('.well-known', function () {
    it('serves assetlinks.json as application/json, with the fingerprint Android wants, in any spelling from env', function (string $configured) {
        config(['speedclub.mobile.android_cert_sha256' => $configured, 'speedclub.mobile.android_package' => 'de.speedclub.app']);

        $response = $this->get('/.well-known/assetlinks.json')->assertOk();

        expect($response->headers->get('Content-Type'))->toBe('application/json')
            ->and($response->headers->getCookies())->toBe([])
            ->and($response->json())->toBe([[
                // M4.6 (09 §8.2): get_login_creds shares the site's passkeys with the app.
                'relation' => ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
                'target' => [
                    'namespace' => 'android_app',
                    'package_name' => 'de.speedclub.app',
                    'sha256_cert_fingerprints' => [CERT_COLONS],
                ],
            ]]);
    })->with(['no colons' => CERT_LOWER, 'colons' => CERT_COLONS]);

    it('takes several fingerprints and drops what is none', function () {
        $second = str_repeat('AB', 32);
        config(['speedclub.mobile.android_cert_sha256' => CERT_LOWER.', '.$second.',kaputt']);

        expect($this->get('/.well-known/assetlinks.json')->json('0.target.sha256_cert_fingerprints'))
            ->toBe([CERT_COLONS, implode(':', str_split($second, 2))]);
    });

    it('is an empty list while no key is set', function () {
        config(['speedclub.mobile.android_cert_sha256' => null]);

        $this->get('/.well-known/assetlinks.json')->assertOk()->assertExactJson([]);
    });

    it('serves the apple-app-site-association with the paths of a sticker, a vehicle page, a member page and the two e-mail screens', function () {
        config(['speedclub.mobile.ios_team_id' => 'ABCDE12345', 'speedclub.mobile.ios_bundle_id' => 'de.speedclub.app']);

        $response = $this->get('/.well-known/apple-app-site-association')->assertOk();

        // /u since PROF-02 exists in the app (M2.1); the e-mail screens as exact paths, without a wildcard, since WEB-07 (SEC-P2-03).
        expect($response->headers->get('Content-Type'))->toBe('application/json')
            ->and($response->json('applinks.details.0.appIDs'))->toBe(['ABCDE12345.de.speedclub.app'])
            ->and($response->json('applinks.details.0.components'))->toBe([
                ['/' => '/v/*'], ['/' => '/u/*'], ['/' => '/c/*'], ['/' => '/C/*'], ['/' => '/app/reset-password'], ['/' => '/app/verify-email'],
                // M4.6: the same-device magic link of the e-mail code (09 §6.5).
                ['/' => '/auth/magic'],
                // M4.7: "Das war ich nicht" of a login alert (09 §8.4).
                ['/' => '/auth/secure'],
                // The same two screens of the member web, which mails may open under /app (app lane, M4.6/M4.7).
                ['/' => '/app/auth/magic'],
                ['/' => '/app/auth/secure'],
            ])
            // M4.6 (09 §8.2): passkeys of this site in the app.
            ->and($response->json('webcredentials'))->toBe(['apps' => ['ABCDE12345.de.speedclub.app']]);
    });

    it('links nothing without a team id', function () {
        config(['speedclub.mobile.ios_team_id' => null]);

        $this->get('/.well-known/apple-app-site-association')->assertOk()->assertExactJson(['applinks' => ['details' => []], 'webcredentials' => ['apps' => []]]);
    });
});
