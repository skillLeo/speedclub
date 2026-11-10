<?php

use App\Actions\Garage\DeleteVehicle;
use App\Enums\LegalDocumentKey;
use App\Enums\QrRevocationReason;
use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\LegalDocument;
use App\Models\Modification;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use App\Services\PublicPages\PublicPageData;
use App\Services\Qr\QrCodes;
use App\Support\KnownBots;
use App\Support\SafeMarkdown;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';
require_once dirname(__DIR__).'/Qr/QrTestHelpers.php';

beforeEach(function () {
    config(['session.driver' => 'database']);
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas', 'city' => 'Stuttgart']);
    $this->vehicle = publishedVehicle($this->owner, ['color' => 'Bayside Blue', 'description' => 'Mein Alltagsauto.']);
    $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
    $this->vehicle->refresh();
});

function assertNoSession(mixed $response): void
{
    expect($response->headers->getCookies())->toBe([])
        ->and(DB::table('sessions')->count())->toBe(0);
}

function signedInCookie(mixed $member): string
{
    // The handler remembers that it has seen a row, so a second session in one test needs a new one.
    app('session')->forgetDrivers();

    return databaseSessionFor($member, 'web');
}

describe('/c/{code} and /C/{code}', function () {
    it('sends both spellings to the canonical page with a 302, never cached', function (string $prefix) {
        $response = $this->get($prefix.$this->qr->code)->assertStatus(302)
            ->assertRedirect('/v/'.$this->vehicle->canonicalSlug());

        expect($response->headers->get('Cache-Control'))->toContain('no-store')
            ->and($response->headers->get('X-Robots-Tag'))->toBe('noindex');

        assertNoSession($response);
    })->with(['/c/', '/C/']);

    it('takes the code in lower case', function () {
        $this->get('/c/'.strtolower($this->qr->code))->assertRedirect('/v/'.$this->vehicle->canonicalSlug());
    });

    it('shows WEB-06 revoked with no way to the vehicle', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);

        $response = $this->withHeader('Accept-Language', 'de')->get('/C/'.$this->qr->code)
            ->assertStatus(410)
            ->assertSee("Dieser QR-\u{2060}Code ist nicht mehr gültig")
            ->assertSee('data-testid="WEB-06.root"', false)
            ->assertSee('data-state="revoked"', false)
            ->assertSee('<meta name="robots" content="noindex">', false);

        expect($response->getContent())
            ->not->toContain('/v/')
            ->not->toContain($this->vehicle->public_id)
            ->not->toContain(strtolower($this->vehicle->public_id))
            ->not->toContain('lukas.sc');

        assertNoSession($response);
    });

    it('shows WEB-06 private with nothing of the vehicle', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();

        $response = $this->withHeader('Accept-Language', 'de')->get('/c/'.$this->qr->code)
            ->assertStatus(404)
            ->assertSee('Dieses Fahrzeug ist privat')
            ->assertSee('data-state="private"', false);

        expect($response->getContent())->not->toContain('/v/')->not->toContain('lukas.sc');
    });

    it('shows WEB-06 not found for an unknown and for a malformed code', function (string $code) {
        $this->withHeader('Accept-Language', 'de')->get('/c/'.$code)
            ->assertNotFound()
            ->assertSee("Diesen QR-\u{2060}Code kennen wir nicht")
            ->assertSee('data-state="not_found"', false);
    })->with(['00000000', 'zu-lang-und-falsch']);

    it('takes the code as the sticker prints it, with a space or a hyphen', function (string $path) {
        $this->qr->forceFill(['code' => '8TR0Q3MC'])->save();

        $this->get($path)->assertStatus(302)->assertRedirect('/v/'.$this->vehicle->canonicalSlug());
    })->with([
        'the printed space' => ['/C/8TR0%20Q3MC'],
        'lower case' => ['/c/8tr0%20q3mc'],
        'a hyphen' => ['/C/8TR0-Q3MC'],
        'an en dash' => ['/C/8TR0%E2%80%93Q3MC'],
    ]);

    it('takes the same input in the API the app resolves with', function () {
        $this->qr->forceFill(['code' => '8TR0Q3MC'])->save();

        $this->getJson('/api/v1/qr/8TR0%20Q3MC')->assertOk()->assertJsonPath('data.state', 'active');
    });

    it('never answers 500 for bytes that are no text at all', function () {
        // The framework refuses such a path before routing (ValidatePathEncoding); Codes::normalize has its own case in CodesTest.
        $this->get('/c/%FF')->assertStatus(400);
    });

    it('speaks English on request', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Reissued);

        $this->get('/c/'.$this->qr->code.'?lang=en')->assertSee('This QR code is no longer valid');
        $this->withHeader('Accept-Language', 'en')->get('/c/'.$this->qr->code)->assertSee('This QR code is no longer valid');
    });

    it('gives a revoked code no reason, and says unavailable only when the vehicle or the account is gone', function (QrRevocationReason $reason, bool $deleteVehicle, string $locale, string $title, string $body) {
        app(QrCodes::class)->revoke($this->vehicle, $reason);

        if ($deleteVehicle) {
            $this->vehicle->delete();
        }

        $html = $this->withHeader('Accept-Language', $locale)->get('/C/'.$this->qr->code)
            ->assertStatus(410)
            ->assertSee('data-state="revoked"', false)
            ->getContent();

        expect($html)
            ->toContain('data-testid="WEB-06.title">'.e($title).'</h1>')
            ->toContain('data-testid="WEB-06.body">'.e($body).'</p>')
            ->not->toContain('Besitzer hat')
            ->not->toContain('owner replaced')
            ->not->toContain('lukas.sc')
            ->not->toContain('/v/');
    })->with(qrRevokedCopy());

    it('keeps saying unavailable after the hard delete, from the tombstone of the code', function () {
        app(DeleteVehicle::class)->handle($this->owner, $this->vehicle);
        Vehicle::withTrashed()->whereKey($this->vehicle->id)->update(['deleted_at' => now()->subDays(31)]);
        $this->artisan('vehicles:prune')->assertSuccessful();

        $this->withHeader('Accept-Language', 'de')->get('/C/'.$this->qr->code)
            ->assertStatus(410)
            ->assertSee('Dieses Fahrzeug ist nicht mehr verfügbar')
            ->assertDontSee("Diesen QR-\u{2060}Code kennen wir nicht");
    });

    it('sends a signed-in owner of a private vehicle to the page, and a blocked member to the private state, with the redirect on', function () {
        // On, as by default: /v sends the owner on to VEH-01 in the member web app, which shows a private vehicle to its owner.
        config(['speedclub.public_pages.redirect_members_to_app' => true]);
        $this->vehicle->forceFill(['visibility' => 'private'])->save();

        $this->withCookie(config()->string('session.cookie'), signedInCookie($this->owner))
            ->get('/c/'.$this->qr->code)
            ->assertRedirect('/v/'.$this->vehicle->canonicalSlug());

        $this->vehicle->forceFill(['visibility' => 'public'])->save();
        $blocked = User::factory()->create();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $blocked->id]);

        $this->withCookie(config()->string('session.cookie'), signedInCookie($blocked))
            ->get('/c/'.$this->qr->code)
            ->assertStatus(404);
    });

    it('leads only where a guest may go with the redirect off, when /v keeps signed-in browsers on Blade, and still does not count the owner', function () {
        config(['speedclub.public_pages.redirect_members_to_app' => false]);
        $browser = ['User-Agent' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'];
        $this->vehicle->forceFill(['visibility' => 'private'])->save();

        // /v answers the owner 404 as it answers a guest, so the sticker says "privat" instead of leading there.
        $this->withHeaders($browser)->withCookie(config()->string('session.cookie'), signedInCookie($this->owner))
            ->withHeader('Accept-Language', 'de')
            ->get('/c/'.$this->qr->code)
            ->assertStatus(404)
            ->assertSee('Dieses Fahrzeug ist privat')
            ->assertSee('data-state="private"', false);

        expect(QrScanDaily::query()->count())->toBe(0);

        $this->vehicle->forceFill(['visibility' => 'public'])->save();

        $this->withHeaders($browser)->withCookie(config()->string('session.cookie'), signedInCookie($this->owner))
            ->get('/c/'.$this->qr->code)
            ->assertRedirect('/v/'.$this->vehicle->canonicalSlug());

        expect(QrScanDaily::query()->count())->toBe(0);

        // The block holds for the member, as it does in the app.
        $blocked = User::factory()->create();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $blocked->id]);

        $this->withHeaders($browser)->withCookie(config()->string('session.cookie'), signedInCookie($blocked))
            ->get('/c/'.$this->qr->code)
            ->assertStatus(404)
            ->assertSee('data-state="private"', false);
    });

    it('answers a page, not an error, above 120 requests a minute', function () {
        config(['speedclub.rate_limits.qr.max' => 1]);
        RateLimits::register();

        $this->get('/c/'.$this->qr->code)->assertRedirect();
        $response = $this->withHeader('Accept-Language', 'de')->get('/c/'.$this->qr->code)
            ->assertStatus(429)
            ->assertHeader('Retry-After')
            ->assertSee('Zu viele Aufrufe')
            ->assertSee('data-state="rate_limited"', false);

        expect($response->headers->get('Content-Type'))->toContain('text/html');
    });
});

describe('?qaNow never moves the server clock', function () {
    it('keeps the resolver limit counting, also with a moment far ahead', function () {
        $remaining = fn (string $query): int => (int) $this->get('/c/00000000'.$query)->headers->get('X-RateLimit-Remaining');

        $first = $remaining('');
        $second = $remaining('?qaNow='.urlencode('2099-01-01T00:00:00Z'));
        $third = $remaining('');

        expect([$second, $third])->toBe([$first - 1, $first - 2])
            ->and(now()->year)->toBeLessThan(2099);
    });

    it('answers 429 once the limit is used up, whatever moments are passed', function () {
        config(['speedclub.rate_limits.qr.max' => 2]);
        RateLimits::register();
        $statuses = [];

        foreach (range(0, 5) as $minutes) {
            $statuses[] = $this->get('/c/'.$this->qr->code.'?qaNow='.urlencode(now()->addMinutes(2 * $minutes)->toIso8601String()))->status();
        }

        expect($statuses)->toBe([302, 302, 429, 429, 429, 429]);
    });

    it('does not count a screenshot run, and never under another day', function () {
        $this->travelTo('2026-11-03 12:00:00');
        $browser = ['User-Agent' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'];

        $this->withHeaders($browser)->get('/C/'.$this->qr->code.'?qaNow='.urlencode('2026-01-01T12:00:00Z'))->assertRedirect();
        $this->withHeaders($browser)->get('/C/'.$this->qr->code.'?qaTheme=light')->assertRedirect();

        expect(QrScanDaily::query()->count())->toBe(0);

        $this->withHeaders($browser)->get('/C/'.$this->qr->code)->assertRedirect();

        expect(QrScanDaily::query()->get()->map(fn (QrScanDaily $row): array => [(string) $row->getRawOriginal('day'), (int) $row->getAttribute('count')])->all())
            ->toBe([['2026-11-03', 1]]);
    });

    it('does not end a suspension early', function () {
        $this->owner->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => now()->addDays(7)->format(DATE_ATOM)]]])->save();
        $slug = $this->vehicle->canonicalSlug();

        $this->get('/v/'.$slug)->assertNotFound();
        $this->get('/v/'.$slug.'?qaNow='.urlencode(now()->addDays(30)->toIso8601String()))->assertNotFound();
        $this->get('/c/'.$this->qr->code.'?qaNow='.urlencode(now()->addDays(30)->toIso8601String()))->assertNotFound()->assertSee('data-state="private"', false);
    });

    it('does not bring back an old username after its 14 days', function () {
        $this->owner->forceFill(['username' => 'lukas.neu', 'previous_username' => 'lukas.sc', 'username_changed_at' => now()->subDays(15)])->save();

        $this->get('/u/lukas.sc?qaNow='.urlencode(now()->subDays(10)->toIso8601String()))->assertNotFound();
    });

    it('still reports the overrides on html', function () {
        expect($this->get('/?qaNow='.urlencode('2026-11-02T10:00:00Z'))->getContent())->toContain('data-qa-state="default"');
    });
});

describe('/v/{slug}', function () {
    it('shows a guest the whole page without JavaScript, a session or a cookie', function () {
        $mod = modInVehicle($this->vehicle);

        $response = $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()
            ->assertSee('data-testid="WEB-01.root"', false)
            ->assertSee('data-testid="VEH-01.hero"', false)
            ->assertSee('data-testid="VEH-01.title"', false)
            ->assertSee('data-testid="VEH-01.specStrip"', false)
            ->assertSee('data-testid="VEH-01.ownerRow"', false)
            ->assertSee('Mein Alltagsauto.')
            ->assertSee('lukas.sc')
            ->assertSee($mod->getAttribute('title'))
            ->assertSee('fetchpriority="high"', false)
            ->assertSee('srcset=', false)
            ->assertSee('In der App öffnen')
            ->assertSee('next=%2Fv%2F'.$this->vehicle->canonicalSlug(), false);

        assertNoSession($response);
    });

    it('carries the SEO of the page', function () {
        $slug = $this->vehicle->canonicalSlug();
        $html = $this->get('/v/'.$slug)->assertOk()->getContent();

        expect($html)->toContain('<link rel="canonical" href="'.url('/v/'.$slug).'">')
            ->toContain('<meta property="og:image"')
            ->toContain('<meta property="og:image:width" content="1200">')
            ->toContain('<meta name="twitter:card" content="summary_large_image">')
            ->toContain('<meta name="description" content="Mein Alltagsauto.">')
            ->not->toContain('name="robots"');

        preg_match_all('~<script type="application/ld\+json"[^>]*>(.*?)</script>~s', $html, $blocks);
        $types = array_map(fn (string $json): string => json_decode($json, true, 512, JSON_THROW_ON_ERROR)['@type'], $blocks[1]);

        expect($types)->toBe(['Vehicle', 'BreadcrumbList']);
    });

    it('escapes what a member typed, also inside JSON-LD', function () {
        $this->vehicle->forceFill(['description' => '</script><script>alert(1)</script>'])->save();

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->not->toContain('<script>alert(1)');
    });

    it('answers 301 to the canonical address, keeping the query', function () {
        $canonical = $this->vehicle->canonicalSlug();

        $this->get('/v/irgendein-text-'.strtolower($this->vehicle->public_id))
            ->assertStatus(301)
            ->assertRedirect('/v/'.$canonical);

        $this->get('/v/irgendein-text-'.strtolower($this->vehicle->public_id).'?lang=en')
            ->assertStatus(301)
            ->assertRedirect('/v/'.$canonical.'?lang=en');
    });

    it('answers the same 404 for everything hidden', function (Closure $hide) {
        $hide($this->vehicle);
        $slug = $this->vehicle->canonicalSlug();

        $response = $this->withHeader('Accept-Language', 'de')->get('/v/'.$slug)
            ->assertNotFound()
            ->assertSee('Fahrzeug nicht verfügbar')
            ->assertSee('<meta name="robots" content="noindex">', false);

        expect($response->getContent())->not->toContain('lukas.sc');
    })->with([
        'private' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'private'])->save()],
        'draft' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['status' => 'draft'])->save()],
        'deleted' => [fn (Vehicle $vehicle) => $vehicle->delete()],
        'suspended owner' => [fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['status' => 'suspended'])->save()],
        'owner without a proved address' => [fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['email_verified_at' => null])->save()],
    ]);

    it('keeps its 301 out of the browser cache, or a renamed car and its old name would redirect in a circle', function () {
        $response = $this->get('/v/irgendein-text-'.strtolower($this->vehicle->public_id))->assertStatus(301);

        expect($response->headers->get('Cache-Control'))->toContain('no-cache')
            ->and($response->headers->get('Cache-Control'))->toContain('private');
    });

    it('answers 404 for a slug without a public id', function () {
        $this->get('/v/gibt-es-nicht')->assertNotFound();
    });

    it('is reachable but not indexed when unlisted or when the owner said no', function (Closure $arrange) {
        $arrange($this->vehicle);

        $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()
            ->assertSee('<meta name="robots" content="noindex">', false);
    })->with([
        'unlisted' => [fn (Vehicle $vehicle) => $vehicle->forceFill(['visibility' => 'unlisted'])->save()],
        'owner with indexing off' => [fn (Vehicle $vehicle) => $vehicle->owner->forceFill(['indexable' => false])->save()],
    ]);

    it('leaves the owner out when the owner asked for it', function () {
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();

        $html = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->not->toContain('VEH-01.ownerRow')->not->toContain('lukas.sc');
    });

    it('agrees with the API on the owner row, which the app reads behind "In der App öffnen"', function (bool $shown) {
        $this->owner->forceFill(['show_owner_on_qr' => $shown])->save();
        $slug = $this->vehicle->canonicalSlug();

        $html = $this->get('/v/'.$slug)->assertOk()->getContent();
        $guest = $this->getJson('/api/v1/public/vehicles/'.$slug)->assertOk();

        Sanctum::actingAs(User::factory()->create());
        $member = $this->getJson('/api/v1/public/vehicles/'.$slug)->assertOk();

        expect(str_contains($html, 'data-testid="VEH-01.ownerRow"'))->toBe($shown)
            ->and($guest->json('data.owner.username'))->toBe($shown ? 'lukas.sc' : null)
            ->and($member->json('data.owner.username'))->toBe($shown ? 'lukas.sc' : null);

        if (! $shown) {
            expect($guest->getContent())->not->toContain('lukas.sc')->not->toContain('Stuttgart')
                ->and($member->getContent())->not->toContain('lukas.sc')->not->toContain('Stuttgart');
        }
    })->with(['owner shown' => true, 'owner hidden' => false]);

    it('still shows the owner their own row in the API', function () {
        $this->owner->forceFill(['show_owner_on_qr' => false])->save();
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk()
            ->assertJsonPath('data.owner.username', 'lukas.sc')
            ->assertJsonPath('data.is_owner', true);
    });

    it('says noindex on every page while the environment forbids indexing', function () {
        config(['speedclub.public_pages.allow_indexing' => false]);

        $this->get('/v/'.$this->vehicle->canonicalSlug())->assertSee('<meta name="robots" content="noindex">', false);
    });

    it('never shows a cost the owner kept private', function () {
        $mod = modInVehicle($this->vehicle);
        $mod->forceFill(['cost_cents' => 123456, 'cost_public' => false])->save();

        expect($this->get('/v/'.$this->vehicle->canonicalSlug())->getContent())->not->toContain('1.234');
    });
});

describe('signed-in web users', function () {
    it('go to the member web app from /v by default, now that VEH-01 exists there', function () {
        expect(config('speedclub.public_pages.redirect_members_to_app'))->toBeTrue();
        $cookie = signedInCookie(User::factory()->create());

        $response = $this->withCookie(config()->string('session.cookie'), $cookie)
            ->get('/v/'.$this->vehicle->canonicalSlug())
            ->assertStatus(302);

        expect($response->headers->get('Location'))->toEndWith('/app/v/'.$this->vehicle->canonicalSlug());
    });

    it('stay on Blade /v with the redirect switched off', function () {
        config(['speedclub.public_pages.redirect_members_to_app' => false]);
        $cookie = signedInCookie(User::factory()->create());
        $before = DB::table('sessions')->get()->toArray();

        $response = $this->withCookie(config()->string('session.cookie'), $cookie)
            ->get('/v/'.$this->vehicle->canonicalSlug())
            ->assertOk()
            ->assertSee('data-testid="WEB-01.root"', false);

        expect($response->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->get()->toArray())->toEqual($before);
    });

    describe('with the redirect on, as by default', function () {
        beforeEach(function () {
            config(['speedclub.public_pages.redirect_members_to_app' => true]);
        });

        it('go to the member web app from /v, with the query', function () {
            $cookie = signedInCookie(User::factory()->create());

            $response = $this->withCookie(config()->string('session.cookie'), $cookie)
                ->get('/v/'.$this->vehicle->canonicalSlug().'?lang=en')
                ->assertStatus(302);

            expect($response->headers->get('Location'))->toEndWith('/app/v/'.$this->vehicle->canonicalSlug().'?lang=en');
        });

        describe('with ?view=public, what QR-04 opens', function () {
            beforeEach(function () {
                $this->mod = modInVehicle($this->vehicle);
                $this->mod->forceFill(['cost_cents' => 987654, 'cost_public' => false, 'notes' => 'Geheimnotiz'])->save();
                app(BuildUpdates::class)->note($this->vehicle, 'Versteckter Eintrag im Verlauf.', hidden: true);
                app(BuildUpdates::class)->note($this->vehicle, 'Öffentlicher Eintrag im Verlauf.');
                $this->slug = $this->vehicle->canonicalSlug();
                $this->cookie = signedInCookie($this->owner);
                // Nonces and the like differ per request; everything a person reads must not.
                $this->page = fn (mixed $response): string => (string) preg_replace('/nonce="[^"]*"/', '', (string) $response->getContent());
            });

            it('shows the real owner the page a guest gets, to the letter', function () {
                $guest = ($this->page)($this->get("/v/{$this->slug}?view=public")->assertOk());
                $owner = $this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}?view=public")->assertOk();

                expect(($this->page)($owner))->toBe($guest)
                    ->and($owner->headers->getCookies())->toBe([]);
            });

            it('holds no private cost, hidden entry, note or owner tool for the owner', function () {
                $html = $this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}?view=public")
                    ->assertOk()
                    ->assertSee('data-testid="WEB-01.root"', false)
                    ->assertSee('Öffentlicher Eintrag im Verlauf.')
                    ->assertDontSee('Versteckter Eintrag im Verlauf.')
                    ->assertDontSee('Geheimnotiz')
                    ->getContent();

                expect($html)->not->toContain('9.876')
                    ->and($html)->not->toContain('987654')
                    ->and($html)->not->toContain('is_owner');
            });

            it('still sends the owner into the app without it', function () {
                $response = $this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}")->assertStatus(302);

                expect($response->headers->get('Location'))->toEndWith("/app/v/{$this->slug}");
            });

            it('only counts the exact value', function (string $query) {
                $this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}?{$query}")->assertStatus(302);
            })->with(['view=PUBLIC', 'view=owner', 'view[]=public', 'view=']);

            it('shows the owner of a private vehicle what a guest sees: nothing', function () {
                $this->vehicle->forceFill(['visibility' => Visibility::Private])->save();

                $guest = ($this->page)($this->get("/v/{$this->slug}?view=public")->assertNotFound());
                $owner = ($this->page)($this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}?view=public")->assertNotFound());

                expect($owner)->toBe($guest)
                    ->and($owner)->not->toContain('Öffentlicher Eintrag');
            });

            it('shows the holder of a token the page a guest gets as well', function () {
                $token = $this->owner->createToken('Pixel 9')->plainTextToken;
                $guest = ($this->page)($this->get("/v/{$this->slug}?view=public")->assertOk());
                $bearer = fn (string $query) => $this->withToken($token)->get("/v/{$this->slug}{$query}")->assertOk();

                // Proves the token counts on this route: without the marker its holder is the owner.
                $bearer('')->assertSee('Versteckter Eintrag im Verlauf.');
                app('auth')->forgetGuards();

                expect(($this->page)($bearer('?view=public')))->toBe($guest);
            });

            it('shows the holder of a token nothing of a private vehicle', function () {
                $token = $this->owner->createToken('Pixel 9')->plainTextToken;
                $this->vehicle->forceFill(['visibility' => Visibility::Private])->save();
                $guest = ($this->page)($this->get("/v/{$this->slug}?view=public")->assertNotFound());

                $this->withToken($token)->get("/v/{$this->slug}")->assertOk();
                app('auth')->forgetGuards();

                expect(($this->page)($this->withToken($token)->get("/v/{$this->slug}?view=public")->assertNotFound()))->toBe($guest);
            });

            it('keeps the canonical link on the plain address, so the marker is not indexed', function () {
                $html = $this->withCookie(config()->string('session.cookie'), $this->cookie)->get("/v/{$this->slug}?view=public")->assertOk()->getContent();

                expect($html)->toContain('<link rel="canonical" href="'.url("/v/{$this->slug}").'"');
            });

            it('survives the redirect of an old slug', function () {
                $this->withCookie(config()->string('session.cookie'), $this->cookie)
                    ->get('/v/irgendein-text-'.strtolower($this->vehicle->public_id).'?view=public')
                    ->assertStatus(301)
                    ->assertRedirect("/v/{$this->slug}?view=public");
            });
        });

        it('go to the member web app from /u as well, since PROF-02 exists there (M2.1)', function () {
            $cookie = signedInCookie(User::factory()->create());
            $before = DB::table('sessions')->get()->toArray();

            $response = $this->withCookie(config()->string('session.cookie'), $cookie)
                ->get('/u/lukas.sc?lang=en')
                ->assertStatus(302)
                ->assertRedirect('/app/u/lukas.sc?lang=en');

            expect($response->headers->getCookies())->toBe([])
                ->and(DB::table('sessions')->get()->toArray())->toEqual($before);
        });

        it('keep a member on Blade /u with ?view=public', function () {
            $cookie = signedInCookie(User::factory()->create());

            $this->withCookie(config()->string('session.cookie'), $cookie)
                ->get('/u/lukas.sc?view=public')
                ->assertOk()
                ->assertSee('data-testid="WEB-02.root"', false);
        });

        it('write nothing and set no cookie for that', function () {
            $cookie = signedInCookie(User::factory()->create());
            $before = DB::table('sessions')->get()->toArray();

            $response = $this->withCookie(config()->string('session.cookie'), $cookie)->get('/v/'.$this->vehicle->canonicalSlug());

            expect($response->headers->getCookies())->toBe([])
                ->and(DB::table('sessions')->get()->toArray())->toEqual($before);
        });

        it('do not count when the cookie belongs to no signed-in member', function (Closure $cookie) {
            $response = $this->withCookie(config()->string('session.cookie'), $cookie())
                ->get('/v/'.$this->vehicle->canonicalSlug())
                ->assertOk();

            expect($response->headers->getCookies())->toBe([]);
        })->with([
            'unknown session' => [fn () => str_repeat('a', 40)],
            'not a session id' => [fn () => 'kaputt'],
            'session that never signed in, as after /sanctum/csrf-cookie' => [function () {
                $id = str_repeat('b', 40);
                DB::table('sessions')->insert(['id' => $id, 'payload' => base64_encode(json_encode(['_token' => 'x'])), 'last_activity' => now()->getTimestamp()]);

                return $id;
            }],
        ]);

        it('do not include a staff session, which has its own cookie', function () {
            $staff = databaseSessionFor(Staff::factory()->create(), 'staff');

            $this->withCookie('sc_staff_session', $staff)->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
        });

        it('leaves a guest and a crawler on the page', function () {
            $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
            $this->get('/u/lukas.sc')->assertOk();
        });
    });
});

describe('/u/{username}', function () {
    it('shows the public garage without a session', function () {
        $hidden = publishedVehicle($this->owner, ['visibility' => 'private', 'nickname' => 'Geheim', 'model_year' => 1999]);
        $unlisted = publishedVehicle($this->owner, ['visibility' => 'unlisted']);

        $response = $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertOk()
            ->assertSee('data-testid="WEB-02.root"', false)
            ->assertSee('Lukas')
            ->assertSee('@lukas.sc')
            ->assertSee('/v/'.$this->vehicle->slug, false)
            ->assertSee('rel="canonical"', false)
            ->assertSee('ProfilePage', false);

        expect($response->getContent())
            ->not->toContain('/v/'.$hidden->slug)
            ->not->toContain('/v/'.$unlisted->slug);

        assertNoSession($response);
    });

    describe('its actions, now that PROF-02 exists (M2.1, ADR-176 f)', function () {
        it('sign in and register with the way back to /u', function () {
            $html = $this->get('/u/lukas.sc')->assertOk()->getContent();
            $next = rawurlencode('/u/lukas.sc');

            expect($html)->toContain('href="'.url('/app/sign-in').'?next='.$next.'"')
                ->and($html)->toContain('href="'.url('/app/sign-up').'?next='.$next.'"');
        });

        it('show "In der App öffnen" beside Registrieren in the bar', function () {
            $page = $this->get('/u/lukas.sc')->assertOk()->getContent();
            $bar = substr($page, (int) strpos($page, 'data-testid="WEB-01.stickyBar"'));

            expect($page)->toContain('data-open-app')
                ->and($page)->toContain('speedclub://u/lukas.sc')
                ->and($bar)->toContain(__('public.vehicle.open_in_app'))
                ->and($bar)->toContain('data-testid="WEB-01.register"');
        });

        it('hand the page the links into the app', function () {
            $data = app(PublicPageData::class)->member($this->owner, request());

            expect($data['links']['web_app'])->toBe(url('/app/u/lukas.sc'))
                ->and($data['links']['deep_link'])->toBe('speedclub://u/lukas.sc')
                ->and($data['links']['sign_in'])->toBe(url('/app/sign-in').'?next='.rawurlencode('/u/lukas.sc'))
                ->and($data['links']['register'])->toBe(url('/app/sign-up').'?next='.rawurlencode('/u/lukas.sc'));
        });

        it('leave the links of /v as they were', function () {
            $slug = $this->vehicle->canonicalSlug();
            $data = app(PublicPageData::class)->vehicle($this->vehicle, request());

            expect($data['links']['web_app'])->toBe(url('/app/v/'.$slug))
                ->and($data['links']['deep_link'])->toBe('speedclub://v/'.$slug)
                ->and($data['links']['sign_in'])->toBe(url('/app/sign-in').'?next='.rawurlencode('/v/'.$slug))
                ->and($data['links']['register'])->toBe(url('/app/sign-up').'?next='.rawurlencode('/v/'.$slug));

            $html = $this->get('/v/'.$slug)->assertOk()->getContent();

            expect($html)->toContain('data-open-app')
                ->and($html)->toContain('speedclub://v/'.$slug);
        });
    });

    it('sends a previous name to the current one for 14 days, then forgets it', function () {
        $this->owner->forceFill(['username' => 'lukas.neu', 'previous_username' => 'lukas.sc', 'username_changed_at' => now()->subDays(13)])->save();

        $this->get('/u/lukas.sc')->assertStatus(302)->assertRedirect('/u/lukas.neu');
        $this->get('/u/lukas.neu')->assertOk();

        $this->owner->forceFill(['username_changed_at' => now()->subDays(15)])->save();

        $this->get('/u/lukas.sc')->assertNotFound();
    });

    it('answers 301 for another spelling of the same name', function () {
        $this->get('/u/Lukas.SC')->assertStatus(301)->assertRedirect('/u/lukas.sc');
    });

    it('keeps the query through both redirects, as /v does', function () {
        $this->get('/u/Lukas.SC?lang=en')->assertStatus(301)->assertRedirect('/u/lukas.sc?lang=en');

        $this->owner->forceFill(['username' => 'lukas.neu', 'previous_username' => 'lukas.sc', 'username_changed_at' => now()->subDays(2)])->save();

        $this->get('/u/lukas.sc?lang=en&qaTheme=light')->assertStatus(302)->assertRedirect('/u/lukas.neu?lang=en&qaTheme=light');
    });

    it('answers the same 404 for anybody who is not public', function (Closure $hide) {
        $hide($this->owner);

        $this->withHeader('Accept-Language', 'de')->get('/u/lukas.sc')->assertNotFound()
            ->assertSee('Mitglied nicht gefunden')
            ->assertSee('<meta name="robots" content="noindex">', false);
    })->with([
        'suspended' => [fn (User $member) => $member->forceFill(['status' => 'suspended'])->save()],
        'deactivated' => [fn (User $member) => $member->forceFill(['status' => 'deactivated'])->save()],
        'unverified' => [fn (User $member) => $member->forceFill(['email_verified_at' => null])->save()],
    ]);

    it('answers 404 for a name nobody has', function () {
        $this->get('/u/gibt.es.nicht')->assertNotFound();
    });

    it('says noindex when the member switched search engines off', function () {
        $this->owner->forceFill(['indexable' => false])->save();

        $this->get('/u/lukas.sc')->assertOk()->assertSee('<meta name="robots" content="noindex">', false);
    });
});

describe('legal pages', function () {
    it('renders each document from the CMS in its language, without a session', function (string $path, LegalDocumentKey $key, string $title) {
        LegalDocument::factory()->published()->create(['key' => $key, 'locale' => 'de', 'body_md' => "## Abschnitt\n\nDer **deutsche** Text."]);
        LegalDocument::factory()->published()->create(['key' => $key, 'locale' => 'en', 'body_md' => 'The English text.']);

        $response = $this->withHeader('Accept-Language', 'de')->get($path)->assertOk()
            ->assertSee('data-testid="WEB-08.root"', false)
            ->assertSee($title)
            ->assertSee('<h2>Abschnitt</h2>', false)
            ->assertSee('<strong>deutsche</strong>', false);

        assertNoSession($response);

        $this->get($path.'?lang=en')->assertOk()->assertSee('The English text.');
    })->with([
        ['/impressum', LegalDocumentKey::Imprint, 'Impressum'],
        ['/datenschutz', LegalDocumentKey::Privacy, 'Datenschutz'],
        ['/agb', LegalDocumentKey::Terms, 'AGB'],
        ['/community-richtlinien', LegalDocumentKey::Community, 'Community-Richtlinien'],
    ]);

    it('falls back to the German text and says so', function () {
        LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'body_md' => 'Nur Deutsch.']);

        $this->get('/agb?lang=en')->assertOk()
            ->assertSee('Nur Deutsch.')
            ->assertSee('which is the binding version');
    });

    it('answers 404 while nothing is published', function () {
        LegalDocument::factory()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'published_at' => null]);

        $this->get('/agb')->assertNotFound();
    });

    it('prints raw HTML and script links as text', function () {
        LegalDocument::factory()->published()->create([
            'key' => LegalDocumentKey::Imprint,
            'locale' => 'de',
            'body_md' => "<script>alert(1)</script>\n\n[Klick](javascript:alert(2)) <img src=x onerror=alert(3)>",
        ]);

        $html = $this->withHeader('Accept-Language', 'de')->get('/impressum')->assertOk()->getContent();

        expect($html)->not->toContain('<script>alert(1)')
            ->not->toContain('<img src=x')
            ->not->toContain('href="javascript:');
    });

    it('has a safe renderer of its own', function () {
        expect(SafeMarkdown::render('<b>x</b>')->toHtml())->not->toContain('<b>')
            ->and(SafeMarkdown::render('[a](data:text/html,x)')->toHtml())->not->toContain('href="data:')
            ->and(SafeMarkdown::render('[a](https://example.org)')->toHtml())->toContain('href="https://example.org"');
    });
});

describe('every public page', function () {
    it('has the footer, with only addresses that answer', function () {
        $html = $this->get('/')->assertOk()->getContent();

        foreach (['/impressum', '/datenschutz', '/agb', '/community-richtlinien'] as $path) {
            expect($html)->toContain('href="'.url($path).'"');
        }

        // M2.5: WEB-05 and WEB-10 answer now, so the footer links them.
        expect($html)->toContain('href="'.url('/konto-loeschen').'"')->toContain('href="'.url('/kontakt').'"')->toContain('href="'.url('/app-laden').'"');
    });

    it('takes the language from ?lang, Accept-Language, then German', function () {
        $this->get('/?lang=en')->assertSee('<html', false)->assertSee('lang="en"', false)->assertSee('Imprint');
        $this->withHeader('Accept-Language', 'en-GB')->get('/')->assertSee('lang="en"', false);
        $this->withHeader('Accept-Language', 'fr')->get('/?lang=xx')->assertSee('lang="de"', false)->assertSee('Impressum');
    });

    it('reports the QA overrides on html outside production', function () {
        $html = $this->get('/v/'.$this->vehicle->canonicalSlug().'?qaTheme=black&qaLocale=en&qaFontScale=2&qaState=error&qaMotion=off')->assertOk()->getContent();

        expect($html)->toContain('data-theme="black"')
            ->toContain('data-qa-theme="black"')
            ->toContain('data-qa-locale="en"')
            ->toContain('data-qa-font-scale="2"')
            ->toContain('data-qa-state="error"')
            ->toContain('data-qa-motion="off"')
            ->toContain('lang="en"')
            ->not->toContain("localStorage.getItem('sc-theme')");
    });

    it('reports nothing without an override, and nothing in production', function () {
        expect($this->get('/')->getContent())->not->toContain('data-qa-theme');

        app()->detectEnvironment(fn (): string => 'production');

        $html = $this->get('/?qaTheme=black&qaLocale=en')->getContent();

        expect($html)->not->toContain('data-qa-theme')->toContain('lang="de"')->toContain('data-theme="system"');
    });

    it('sends the CSP with a nonce that every script and style carries', function () {
        $response = $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
        $html = $response->getContent();

        preg_match("~'nonce-([^']+)'~", (string) $response->headers->get('Content-Security-Policy'), $nonce);

        expect($nonce)->not->toBeEmpty();

        preg_match_all('~<(script|style)\b(?![^>]*\bsrc=)[^>]*>~', $html, $inline);

        foreach ($inline[0] as $tag) {
            expect($tag)->toContain('nonce="'.$nonce[1].'"');
        }
    });

    it('shows a page for an address that does not exist', function () {
        $this->withHeader('Accept-Language', 'de')->get('/gibt-es-nicht')->assertNotFound()->assertSee('Diese Seite gibt es nicht');
    });
});

describe('KnownBots', function () {
    it('tells browsers from machines', function (?string $agent, bool $machine) {
        expect(KnownBots::matches($agent))->toBe($machine);
    })->with([
        'Chrome on Android' => ['Mozilla/5.0 (Linux; Android 14; SM-S938B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', false],
        'Safari on iPhone' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', false],
        // In-app browsers: the camera of Snapchat scans a sticker and opens the page in its own browser.
        'Snapchat on iPhone' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.55.0.36 (like Safari/8618.2.12.10.6, panda)', false],
        'Snapchat on Android' => ['Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36Snapchat/12.90.0.46 (like Chrome/125.0.6422.165)', false],
        'LinkedIn app' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.6', false],
        'Pinterest app' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest/iOS]', false],
        'X on iPhone' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.48', false],
        'X on Android' => ['Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240605.024; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 TwitterAndroid', false],
        'Telegram on Android' => ['Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240605.024; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Telegram-Android/11.1.3 (Google Pixel 8; Android 14; SDK 34; AVERAGE)', false],
        'Discord desktop' => ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9147 Chrome/120.0.6099.291 Electron/28.2.10 Safari/537.36', false],
        'Instagram' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,3; iOS 17_5; de_DE; de; scale=3.00; 1290x2796; 615432343)', false],
        'Facebook app' => ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.98;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBLC/de_DE]', false],
        'TikTok on Android' => ['Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 trill_350402 JsSdk/1.0 NetType/WIFI AppName/trill BytedanceWebview/d8a21c6', false],
        'WebView on a Cubot phone' => ['Mozilla/5.0 (Linux; Android 13; CUBOT P80 Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36', false],
        // The preview fetchers of the same apps.
        'Snap preview' => ['Mozilla/5.0 (compatible; Snap URL Preview Service; bot; snapchat_proxy)', true],
        'LinkedInBot' => ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', true],
        'Pinterestbot' => ['Mozilla/5.0 (compatible; Pinterestbot/1.0; +http://www.pinterest.com/bot.html)', true],
        'old Pinterest fetcher' => ['Pinterest/0.2 (+http://www.pinterest.com/bot.html)', true],
        'Twitterbot' => ['Twitterbot/1.0', true],
        'TelegramBot' => ['TelegramBot (like TwitterBot)', true],
        'Discordbot' => ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', true],
        'Slackbot' => ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', true],
        'Slack image proxy' => ['Slack-ImgProxy (+https://api.slack.com/robots)', true],
        'WhatsApp' => ['WhatsApp/2.23.20.0 A', true],
        'iMessage' => ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0', true],
        'AhrefsBot' => ['Mozilla/5.0 (compatible; AhrefsBot/7.0)', true],
        'no user agent' => [null, true],
    ]);
});

function modInVehicle(Vehicle $vehicle): Modification
{
    seedModSchema();

    return modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Hi-Power']);
}
