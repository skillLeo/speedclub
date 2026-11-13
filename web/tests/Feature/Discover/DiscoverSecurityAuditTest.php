<?php

use App\Enums\Visibility;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * Security and privacy review of M1.8 (HOME-01, DISC-01, DISC-02 P1-lite), 07_QA_AND_RELEASE §6 and 08_LEGAL_COMPLIANCE:
 * what a list may show, to whom, and what the routes leave behind (sessions, caches, SQL). DiscoverEndpointsTest holds the
 * functional matrix; this file pins the controls the review confirmed, so a later change cannot loosen them unnoticed.
 */
function discSecBuild(string $make, string $model, ?string $generation, ?User $owner = null, array $attributes = []): Vehicle
{
    $makeRow = Make::query()->firstOrCreate(['slug' => Str::slug($make)], ['name' => $make, 'country' => 'DE']);
    $modelRow = VehicleModel::query()->firstOrCreate(['make_id' => $makeRow->id, 'slug' => Str::slug($model)], ['name' => $model]);
    $generationRow = $generation === null ? null : Generation::query()->firstOrCreate(
        ['model_id' => $modelRow->id, 'slug' => Str::slug($generation)],
        ['name' => $generation, 'year_from' => 1990, 'year_to' => null],
    );

    $vehicle = publishedVehicle($owner ?? User::factory()->create(), [
        'make_id' => $makeRow->id, 'model_id' => $modelRow->id, 'generation_id' => $generationRow?->id, ...$attributes,
    ]);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $vehicle;
}

/**
 * Every M1.8 route a guest can call, with a query that meets the builds of discSecBuild('Nissan', …).
 *
 * @return list<string>
 */
function discSecRoutes(): array
{
    return [
        '/api/v1/home/featured',
        '/api/v1/home/new-builds',
        '/api/v1/discover',
        '/api/v1/search?q=nissan',
        '/api/v1/search/vehicles?q=nissan',
        '/api/v1/search/users?q=nissan',
    ];
}

/**
 * The vehicle ids of every list a build can appear in.
 *
 * @return array<string, list<string>>
 */
function discSecLists(string $query): array
{
    $test = test();
    $ids = fn (?array $rows): array => array_values(array_map(fn (array $row): string => $row['vehicle']['id'] ?? $row['id'], $rows ?? []));

    return [
        'featured' => $ids($test->getJson('/api/v1/home/featured')->assertOk()->json('data')),
        'new builds' => $ids($test->getJson('/api/v1/home/new-builds?per_page=50')->assertOk()->json('data')),
        'search' => $ids($test->getJson('/api/v1/search?q='.urlencode($query))->assertOk()->json('data.vehicles.items')),
        'search vehicles' => $ids($test->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->json('data')),
    ];
}

function discSecCursor(array $parameters): string
{
    return rtrim(strtr(base64_encode((string) json_encode([...$parameters, '_pointsToNextItems' => true])), '+/', '-_'), '=');
}

describe('a hidden owner stays hidden (show_owner_on_qr, ADR-148 a)', function () {
    it('names nobody on any card, and nothing in the body points to the owner', function (bool $asMember) {
        $owner = User::factory()->create([
            'username' => 'verdeckt.fahrer', 'display_name' => 'Verena Deckname', 'city' => 'Quedlinburg', 'show_owner_on_qr' => false,
        ]);
        $vehicle = discSecBuild('Nissan', 'Skyline GT-R', 'R34', $owner);

        if ($asMember) {
            Sanctum::actingAs(User::factory()->create());
        }

        $bodies = [
            'featured' => $this->getJson('/api/v1/home/featured')->assertOk(),
            'new builds' => $this->getJson('/api/v1/home/new-builds')->assertOk(),
            'search' => $this->getJson('/api/v1/search?q=skyline')->assertOk(),
            'search vehicles' => $this->getJson('/api/v1/search/vehicles?q=skyline')->assertOk(),
        ];

        expect($bodies['featured']->json('data.0.vehicle.id'))->toBe($vehicle->id)
            ->and($bodies['featured']->json('data.0.vehicle.owner'))->toBeNull()
            ->and($bodies['new builds']->json('data.0.owner'))->toBeNull()
            ->and($bodies['search']->json('data.vehicles.items.0.owner'))->toBeNull()
            ->and($bodies['search vehicles']->json('data.0.owner'))->toBeNull();

        foreach ($bodies as $list => $response) {
            $raw = (string) $response->getContent();

            foreach ([$owner->id, strtolower($owner->id), 'verdeckt', 'Verena', 'Deckname', 'Quedlinburg', $owner->email] as $needle) {
                expect(str_contains($raw, (string) $needle))->toBeFalse("$list leaks $needle");
            }
        }
    })->with(['guest' => false, 'other member' => true]);

    it('cannot be found through the build by the owner\'s username or name', function () {
        $owner = User::factory()->create(['username' => 'verdeckt.fahrer', 'display_name' => 'Verena Deckname', 'show_owner_on_qr' => false]);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34', $owner);

        foreach (['verdeckt', 'verdeckt.fahrer', 'deckname', 'Verena'] as $query) {
            $this->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->assertJsonCount(0, 'data');
            $this->getJson('/api/v1/search?q='.urlencode($query))->assertOk()->assertJsonPath('data.vehicles.count', 0);
        }
    });
});

describe('non-discoverable members', function () {
    it('are never found, not by the exact username, the @-form, the display name or the overview count', function (bool $asMember) {
        User::factory()->create(['username' => 'unsichtbar.r34', 'display_name' => 'Ulrike Unsichtbar', 'discoverable' => false]);

        if ($asMember) {
            Sanctum::actingAs(User::factory()->create());
        }

        foreach (['unsichtbar.r34', '@unsichtbar.r34', 'UNSICHTBAR.R34', 'Ulrike Unsichtbar', 'unsichtbar', 'r34'] as $query) {
            $this->getJson('/api/v1/search/users?q='.urlencode($query))->assertOk()->assertJsonCount(0, 'data');
            $this->getJson('/api/v1/search?q='.urlencode($query))->assertOk()
                ->assertJsonPath('data.members.count', 0)
                ->assertJsonCount(0, 'data.members.items');
        }
    })->with(['guest' => false, 'other member' => true]);
});

describe('blocks hold in both directions on every list', function () {
    it('drops the other side from vehicle lists, make tiles and member search', function (string $direction) {
        $owner = User::factory()->create(['username' => 'blockiert.r34', 'display_name' => 'Bernd Block']);
        $vehicle = discSecBuild('Nissan', 'Skyline GT-R', 'R34', $owner);
        $viewer = User::factory()->create();
        Block::factory()->create($direction === 'viewer blocked the owner'
            ? ['blocker_id' => $viewer->id, 'blocked_id' => $owner->id]
            : ['blocker_id' => $owner->id, 'blocked_id' => $viewer->id]);
        Sanctum::actingAs($viewer);

        foreach (discSecLists('skyline') as $list => $ids) {
            expect($ids)->not->toContain($vehicle->id, $list);
        }

        $this->getJson('/api/v1/discover')->assertOk()->assertJsonCount(0, 'data.makes');
        $this->getJson('/api/v1/search/users?q=blockiert.r34')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/search?q=blockiert.r34')->assertOk()->assertJsonPath('data.members.count', 0);
        $this->getJson('/api/v1/search?q=skyline')->assertOk()->assertJsonPath('data.vehicles.count', 0);
    })->with(['viewer blocked the owner', 'owner blocked the viewer']);
});

describe('documented shape only', function () {
    it('gives a card, its owner row and a member row exactly the documented keys, and no private data in the body', function () {
        seedModSchema();
        $owner = User::factory()->create(['username' => 'form.r34', 'display_name' => 'Fritz Form', 'city' => 'Stuttgart']);
        $vehicle = discSecBuild('Nissan', 'Skyline GT-R', 'R34', $owner);
        modIn($vehicle, 'other', [], ['title' => 'Teil', 'notes' => 'Geheimnotiz', 'cost_cents' => 987654, 'cost_public' => false]);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        DB::table('users')->where('id', $owner->id)->update(['last_seen_at' => now()]);

        $card = $this->getJson('/api/v1/home/new-builds')->assertOk()->json('data.0');
        $member = $this->getJson('/api/v1/search/users?q=form.r34')->assertOk()->json('data.0');

        expect(array_keys($card))->toEqualCanonicalizing([
            'id', 'public_id', 'slug', 'status', 'visibility', 'is_main', 'eyebrow', 'make', 'model', 'generation', 'title',
            'full_title', 'nickname', 'color', 'model_year', 'subline_parts', 'spec_strip', 'cover', 'photo_count', 'mod_count',
            'published_at', 'updated_at', 'wizard', 'completeness', 'qr', 'owner', 'latest_update',
            // M4.8: the reader's own state (null for guests); M4.9: the owner's Verlauf count (null for anybody else).
            'viewer', 'updates_count',
            // M4.2 (09 §8.19): the Beispiel badge.
            'is_sample',
        ])
            ->and(array_keys($card['owner']))->toEqualCanonicalizing(['username', 'display_name', 'city', 'avatar', 'is_sample', 'is_editorial'])
            ->and(array_keys($card['cover']))->toEqualCanonicalizing([
                'id', 'status', 'category', 'width', 'height', 'blurhash', 'thumbhash', 'focal_x', 'focal_y', 'alt', 'sort', 'variants', 'created_at',
            ])
            // M2.4 MSG-03 adds the viewer's own can_message and its reason; M4.2 the Beispiel and Editorial badges.
            ->and(array_keys($member))->toEqualCanonicalizing(['username', 'display_name', 'city', 'avatar', 'is_sample', 'is_editorial', 'garage', 'is_self', 'is_following', 'can_message', 'cannot_message_reason'])
            ->and(array_keys($member['garage']))->toEqualCanonicalizing(['vehicles', 'makes', 'line']);

        foreach (discSecRoutes() as $url) {
            $raw = (string) $this->getJson(str_replace('nissan', 'form.r34', $url))->assertOk()->getContent();

            foreach ([$owner->email, $owner->id, 'Geheimnotiz', '987654', '9876,54', '9.876', 'last_seen', 'email', 'latitude', 'longitude', '"lat"', '"lng"', '"gps', '"exif', 'original', 'owner_id'] as $needle) {
                expect(str_contains($raw, (string) $needle))->toBeFalse("$url leaks $needle");
            }
        }
    });
});

describe('search input is bounded and stays a value in SQL', function () {
    it('takes LIKE wildcards, the escape character and a backslash as plain text', function (string $query) {
        User::factory()->create(['username' => 'kenji.r34', 'display_name' => 'Kenji Sato']);
        User::factory()->create(['username' => 'karl.r34', 'display_name' => 'Karl Sato']);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');

        $this->getJson('/api/v1/search/users?q='.urlencode($query))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/search?q='.urlencode($query))->assertOk()->assertJsonPath('data.members.count', 0);
    })->with([
        'underscore for one letter' => ['k_nji'],
        'percent in the middle' => ['k%r34'],
        'percent at the end' => ['ka%'],
        'escape character' => ['kenji!'],
        'escaped underscore' => ['k!_nji'],
        'backslash' => ['ken\\'],
        'backslash escape of percent' => ['k\\%'],
        'quote' => ["kenji'"],
        'injection' => ["k' OR '1'='1"],
        'comment' => ['k%25 -- '],
    ]);

    it('never writes the typed text into the SQL, only into bindings', function () {
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');
        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });

        $marker = "zq9x'\") OR 1=1 #";
        $this->getJson('/api/v1/search?q='.urlencode($marker))->assertOk();
        $this->getJson('/api/v1/search/vehicles?q='.urlencode($marker))->assertOk();
        $this->getJson('/api/v1/search/users?q='.urlencode($marker))->assertOk();

        expect($statements)->not->toBeEmpty();

        foreach ($statements as $sql) {
            expect(str_contains(strtolower($sql), 'zq9x'))->toBeFalse($sql);
        }
    });

    it('caps a query at 100 characters and six words, whatever the characters', function () {
        $this->getJson('/api/v1/search?q='.urlencode(str_repeat('ä', 101)))->assertUnprocessable();
        $this->getJson('/api/v1/search?q='.urlencode(str_repeat('ä', 100)))->assertOk();

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });
        // 50 one-letter words in 99 characters.
        $this->getJson('/api/v1/search?q='.urlencode(implode(' ', array_map(fn (int $i): string => chr(97 + $i % 26), range(0, 49)))))->assertOk();

        foreach ($statements as $sql) {
            expect(substr_count(strtolower($sql), 'search_keys like'))->toBeLessThanOrEqual(6)
                ->and(substr_count(strtolower($sql), 'u.username like ?'))->toBeLessThanOrEqual(1 + 6 * 3 + 6);
        }
    });

    it('answers 422, never 500, to cursors with the right keys and the wrong types', function (string $url) {
        $status = $this->getJson($url)->status();

        expect($status)->toBeIn([200, 422]);
    })->with([
        'vehicles: relevance as text' => ['/api/v1/search/vehicles?q=nissan&cursor='.discSecCursor(['relevance' => 'x) OR 1=1', 'sort_at' => '2026-01-01 00:00:00', 'id' => 'a'])],
        'vehicles: boolean id' => ['/api/v1/search/vehicles?q=nissan&cursor='.discSecCursor(['relevance' => 3, 'sort_at' => true, 'id' => false])],
        'vehicles: array value' => ['/api/v1/search/vehicles?q=nissan&cursor='.discSecCursor(['relevance' => [1], 'sort_at' => 'x', 'id' => 'a'])],
        'members: float username' => ['/api/v1/search/users?q=nissan&cursor='.discSecCursor(['relevance' => 1.5, 'username' => 2.5])],
        'new builds: quote in sort_at' => ['/api/v1/home/new-builds?cursor='.discSecCursor(['sort_at' => "' OR 1=1 #", 'id' => 'a'])],
        'page size as array' => ['/api/v1/search/vehicles?q=nissan&per_page[]=1'],
        'cursor of 1001 characters' => ['/api/v1/search/vehicles?q=nissan&cursor='.str_repeat('a', 1001)],
    ]);
});

describe('rate limits per address and per member', function () {
    it('counts a guest with a forged token or a forged forwarding header against the same address', function () {
        config(['speedclub.rate_limits.search.max' => 2]);
        RateLimits::register();

        $this->getJson('/api/v1/search?q=m4')->assertOk();
        $this->getJson('/api/v1/search/users?q=m4')->assertOk();
        $this->withHeader('Authorization', 'Bearer 1|'.Str::random(40))->getJson('/api/v1/search?q=m4')->assertTooManyRequests();
        $this->flushHeaders()->withHeader('X-Forwarded-For', '203.0.113.9')->getJson('/api/v1/search/vehicles?q=m4')->assertTooManyRequests();
    });

    it('keeps the search limit of a member when the member changes address', function () {
        config(['speedclub.rate_limits.search.max' => 2]);
        RateLimits::register();
        Sanctum::actingAs(User::factory()->create());

        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])->getJson('/api/v1/search?q=m4')->assertOk();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.2'])->getJson('/api/v1/search?q=m4')->assertOk();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.3'])->getJson('/api/v1/search?q=m4')->assertTooManyRequests();
    });
});

describe('no session, no shared caching', function () {
    it('starts no session and sets no cookie for a guest, even from the SPA origin', function (string $url) {
        config(['session.driver' => 'database']);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');
        $before = DB::table('sessions')->count();

        $response = $this->withHeaders(['Origin' => 'http://localhost:8080', 'Referer' => 'http://localhost:8080/app/discover'])
            ->getJson($url)->assertOk();

        expect($response->headers->getCookies())->toBe([])
            ->and($response->headers->get('Set-Cookie'))->toBeNull()
            ->and(DB::table('sessions')->count())->toBe($before);
    })->with(discSecRoutes());

    it('marks every answer private and revalidated, for guests and for members, also on 304', function (bool $asMember) {
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');

        if ($asMember) {
            Sanctum::actingAs(User::factory()->create());
        }

        foreach (discSecRoutes() as $url) {
            $response = $this->getJson($url)->assertOk();
            $notModified = $this->getJson($url, ['If-None-Match' => (string) $response->headers->get('ETag')])->assertStatus(304);

            foreach ([$response, $notModified] as $answer) {
                /** @var TestResponse $answer */
                $cache = (string) $answer->headers->get('Cache-Control');

                expect($cache)->toContain('private')->toContain('no-cache')
                    ->and($cache)->not->toContain('public')
                    ->and($cache)->not->toContain('s-maxage')
                    ->and($cache)->not->toMatch('/max-age=[1-9]/');
            }
        }
    })->with(['guest' => false, 'member' => true]);
});

describe('what a member row may count (second pass)', function () {
    it('counts only published public builds in the garage line, nothing private, unlisted, draft, archived or deleted', function () {
        $member = User::factory()->create(['username' => 'zaehler.r34', 'display_name' => 'Zora Zaehler']);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34', $member, ['is_main' => true]);
        $private = discSecBuild('Mazda', 'RX-7', 'FD', $member);
        $unlisted = discSecBuild('Honda', 'NSX', 'NA1', $member);
        $draft = discSecBuild('Toyota', 'Supra', 'A80', $member);
        $archived = discSecBuild('Subaru', 'Impreza', 'GC8', $member);
        $deleted = discSecBuild('Porsche', '911', '993', $member);
        Vehicle::query()->whereKey($private->id)->update(['visibility' => Visibility::Private->value]);
        Vehicle::query()->whereKey($unlisted->id)->update(['visibility' => Visibility::Unlisted->value]);
        Vehicle::query()->whereKey($draft->id)->update(['status' => 'draft']);
        Vehicle::query()->whereKey($archived->id)->update(['status' => 'archived']);
        $deleted->delete();

        foreach (['/api/v1/search/users?q=zaehler.r34' => 'data.0', '/api/v1/search?q=zaehler.r34' => 'data.members.items.0'] as $url => $path) {
            $row = $this->withHeader('Accept-Language', 'de')->getJson($url)->assertOk()->json($path);

            expect($row['garage'])->toBe(['vehicles' => 1, 'makes' => ['Nissan'], 'line' => '1 Fahrzeug · Nissan']);
        }
    });
});

describe('no lookup by what is not public (second pass)', function () {
    it('finds no member by the e-mail address or its local part, and no build by an undiscoverable owner\'s name', function () {
        $owner = User::factory()->create([
            'username' => 'ohnefund.r34', 'display_name' => 'Olga Ohnefund', 'email' => 'privatpostfach.xy@example.org', 'discoverable' => false,
        ]);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34', $owner);
        User::factory()->create(['username' => 'sichtbar.r33', 'display_name' => 'Sven Sichtbar', 'email' => 'zweitpostfach.qz@example.org']);

        foreach (['privatpostfach.xy@example.org', 'privatpostfach', 'zweitpostfach.qz@example.org', 'zweitpostfach', 'example.org'] as $query) {
            $this->getJson('/api/v1/search/users?q='.urlencode($query))->assertOk()->assertJsonCount(0, 'data');
            $this->getJson('/api/v1/search?q='.urlencode($query))->assertOk()
                ->assertJsonPath('data.members.count', 0)
                ->assertJsonPath('data.vehicles.count', 0);
        }

        foreach (['ohnefund', 'ohnefund.r34', 'olga'] as $query) {
            $this->getJson('/api/v1/search/vehicles?q='.urlencode($query))->assertOk()->assertJsonCount(0, 'data');
        }
    });
});

describe('odd input answers 422, never 500 (second pass)', function () {
    it('refuses arrays, empty and punctuation-only queries on every search route', function (string $query) {
        foreach (['/api/v1/search', '/api/v1/search/vehicles', '/api/v1/search/users'] as $route) {
            $this->getJson($route.$query)->assertUnprocessable()->assertJsonPath('code', 'validation_failed');
        }
    })->with([
        'no q' => [''],
        'q as array' => ['?q[]=m4'],
        'q as nested array' => ['?q[a][b]=m4'],
        'only wildcards' => ['?q='.urlencode('%_%')],
        'only spaces' => ['?q='.urlencode('   ')],
        'page size as text' => ['?q=m4&per_page=zehn'],
        'page size above the cap' => ['?q=m4&per_page=51'],
    ]);

    it('refuses a cursor as an array and a cursor on the overview', function (string $url) {
        $this->getJson($url)->assertUnprocessable();
    })->with([
        '/api/v1/home/new-builds?cursor[]=x',
        '/api/v1/search/vehicles?q=m4&cursor[]=x',
        '/api/v1/search?q=m4&cursor=eyJpZCI6ImEifQ',
    ]);
});

describe('members get no cookie and no session either (second pass)', function () {
    it('answers a bearer-token member without a cookie and without a sessions row', function (string $url) {
        config(['session.driver' => 'database']);
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');
        Sanctum::actingAs(User::factory()->create());
        $before = DB::table('sessions')->count();

        $response = $this->getJson($url)->assertOk();

        expect($response->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->count())->toBe($before);
    })->with(discSecRoutes());

    it('starts no session for a guest from the SPA origin that still sends a session cookie nobody holds', function () {
        config(['session.driver' => 'database']);
        $before = DB::table('sessions')->count();

        $response = $this->withHeaders(['Origin' => 'http://localhost:8080', 'Referer' => 'http://localhost:8080/app/discover'])
            ->withCookie(config()->string('session.cookie'), str_repeat('a', 40))
            ->getJson('/api/v1/home/new-builds')->assertOk();

        expect($response->headers->getCookies())->toBe([])
            ->and(DB::table('sessions')->count())->toBe($before);
    });

    it('sends a 304 without a body', function () {
        discSecBuild('Nissan', 'Skyline GT-R', 'R34');
        $first = $this->getJson('/api/v1/home/new-builds')->assertOk();
        $again = $this->getJson('/api/v1/home/new-builds', ['If-None-Match' => (string) $first->headers->get('ETag')])->assertStatus(304);

        expect((string) $again->getContent())->toBe('');
    });
});
