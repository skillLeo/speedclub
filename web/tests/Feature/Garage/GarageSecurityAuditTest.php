<?php

use App\Enums\ModerationStatus;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Support\Slug;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/GarageTestHelpers.php';

/*
 * The security audit of M1.6 against 07_QA_AND_RELEASE §6: what GarageSecurityTest and the endpoint tests did not yet prove. The
 * route table checks every object route for every kind of caller, and that a refusal really changed nothing.
 */

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
});

/**
 * @param  array<string, mixed>  $attributes
 * @return array{vehicle: Vehicle, mod: Modification, photo: Media, modPhoto: Media, update: BuildUpdate}
 */
function gaTargets(User $owner, array $attributes = []): array
{
    $vehicle = publishedVehicle($owner, $attributes);
    $mod = modIn($vehicle, 'exhaust', attributes: ['title' => 'Auspuff', 'cost_cents' => 7654321, 'notes' => 'GEHEIME-NOTIZ', 'status' => 'installed']);

    return [
        'vehicle' => $vehicle,
        'mod' => $mod,
        'photo' => Media::query()->where('mediable_id', $vehicle->id)->firstOrFail(),
        'modPhoto' => Media::factory()->forModel($mod)->create(['owner_id' => $owner->id]),
        'update' => BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => true, 'note' => 'VERSTECKTE-NOTIZ', 'payload' => null, 'type' => 'note']),
    ];
}

/**
 * Every object route of the garage. closed: refused under a publishing restriction or a suspension; open: a member can always read
 * and take their own content down. success: what the owner gets, null where the target state rules it out.
 *
 * @return array<string, array{method: string, path: string, body: Closure(array<string, mixed>): array<string, mixed>, stranger: int, restriction: string, success: int|null}>
 */
function gaObjectRoutes(): array
{
    $none = fn (array $t): array => [];
    $file = fn (array $t): array => ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))];

    return [
        'read vehicle' => ['method' => 'GET', 'path' => '/vehicles/{vehicle}', 'body' => $none, 'stranger' => 404, 'restriction' => 'open', 'success' => 200],
        'edit vehicle' => ['method' => 'PATCH', 'path' => '/vehicles/{vehicle}', 'body' => fn (array $t): array => ['nickname' => 'Uebernommen'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'replace specs' => ['method' => 'PUT', 'path' => '/vehicles/{vehicle}/specs', 'body' => fn (array $t): array => ['torque_nm' => 400], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'publish' => ['method' => 'POST', 'path' => '/vehicles/{vehicle}/publish', 'body' => $none, 'stranger' => 403, 'restriction' => 'closed', 'success' => null],
        'make main' => ['method' => 'POST', 'path' => '/vehicles/{vehicle}/main', 'body' => $none, 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'expose' => ['method' => 'PATCH', 'path' => '/vehicles/{vehicle}/visibility', 'body' => fn (array $t): array => ['visibility' => 'public'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'hide' => ['method' => 'PATCH', 'path' => '/vehicles/{vehicle}/visibility', 'body' => fn (array $t): array => ['visibility' => 'private'], 'stranger' => 403, 'restriction' => 'open', 'success' => 200],
        'list updates' => ['method' => 'GET', 'path' => '/vehicles/{vehicle}/updates', 'body' => $none, 'stranger' => 404, 'restriction' => 'open', 'success' => 200],
        'write note' => ['method' => 'POST', 'path' => '/vehicles/{vehicle}/updates', 'body' => fn (array $t): array => ['note' => 'Fremd'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 201],
        'hide update' => ['method' => 'PATCH', 'path' => '/updates/{update}', 'body' => fn (array $t): array => ['hidden' => true], 'stranger' => 403, 'restriction' => 'open', 'success' => 200],
        'show update' => ['method' => 'PATCH', 'path' => '/updates/{update}', 'body' => fn (array $t): array => ['hidden' => false], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'list mods' => ['method' => 'GET', 'path' => '/vehicles/{vehicle}/mods', 'body' => $none, 'stranger' => 404, 'restriction' => 'open', 'success' => 200],
        'add mod' => ['method' => 'POST', 'path' => '/vehicles/{vehicle}/mods', 'body' => fn (array $t): array => ['category' => 'other', 'title' => 'Fremd'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 201],
        'reorder mods' => ['method' => 'PUT', 'path' => '/vehicles/{vehicle}/mods/order', 'body' => fn (array $t): array => ['ids' => [$t['mod']->id]], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'read mod' => ['method' => 'GET', 'path' => '/mods/{mod}', 'body' => $none, 'stranger' => 404, 'restriction' => 'open', 'success' => 200],
        'edit mod' => ['method' => 'PATCH', 'path' => '/mods/{mod}', 'body' => fn (array $t): array => ['notes' => 'Fremd'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'upload mod photo' => ['method' => 'POST', 'path' => '/mods/{mod}/media', 'body' => $file, 'stranger' => 403, 'restriction' => 'closed', 'success' => 201],
        'upload vehicle photo' => ['method' => 'POST', 'path' => '/vehicles/{vehicle}/media', 'body' => $file, 'stranger' => 403, 'restriction' => 'closed', 'success' => 201],
        'reorder photos' => ['method' => 'PUT', 'path' => '/vehicles/{vehicle}/media/order', 'body' => fn (array $t): array => ['ids' => [$t['photo']->id]], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'edit photo' => ['method' => 'PATCH', 'path' => '/media/{photo}', 'body' => fn (array $t): array => ['alt' => 'Fremd'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'edit mod photo' => ['method' => 'PATCH', 'path' => '/media/{modPhoto}', 'body' => fn (array $t): array => ['alt' => 'Fremd'], 'stranger' => 403, 'restriction' => 'closed', 'success' => 200],
        'delete mod photo' => ['method' => 'DELETE', 'path' => '/media/{modPhoto}', 'body' => $none, 'stranger' => 403, 'restriction' => 'open', 'success' => 204],
        'delete photo' => ['method' => 'DELETE', 'path' => '/media/{photo}', 'body' => $none, 'stranger' => 403, 'restriction' => 'open', 'success' => 204],
        'delete mod' => ['method' => 'DELETE', 'path' => '/mods/{mod}', 'body' => $none, 'stranger' => 403, 'restriction' => 'open', 'success' => 204],
        'delete vehicle' => ['method' => 'DELETE', 'path' => '/vehicles/{vehicle}', 'body' => $none, 'stranger' => 403, 'restriction' => 'open', 'success' => 204],
    ];
}

/**
 * @param  array{method: string, path: string, body: Closure(array<string, mixed>): array<string, mixed>, stranger: int, restriction: string, success: int|null}  $route
 * @param  array{vehicle: Vehicle, mod: Modification, photo: Media, modPhoto: Media, update: BuildUpdate}  $targets
 */
function gaCall(array $route, array $targets): TestResponse
{
    $url = '/api/v1'.str_replace(
        ['{vehicle}', '{mod}', '{update}', '{photo}', '{modPhoto}'],
        [$targets['vehicle']->id, $targets['mod']->id, $targets['update']->id, $targets['photo']->id, $targets['modPhoto']->id],
        $route['path'],
    );
    $body = $route['body']($targets);

    // A multipart upload cannot go through json().
    return isset($body['file'])
        ? test()->post($url, $body, ['Accept' => 'application/json'])
        : test()->json($route['method'], $url, $body);
}

/**
 * The rows a refused request must leave as they were.
 *
 * @param  array{vehicle: Vehicle, mod: Modification, photo: Media, modPhoto: Media, update: BuildUpdate}  $targets
 * @return array<string, mixed>
 */
function gaState(array $targets): array
{
    return [
        'vehicles' => DB::table('vehicles')->where('id', $targets['vehicle']->id)->get()->all(),
        'specs' => DB::table('vehicle_specs')->where('vehicle_id', $targets['vehicle']->id)->get()->all(),
        'mods' => DB::table('modifications')->where('vehicle_id', $targets['vehicle']->id)->get()->all(),
        'media' => DB::table('media')->orderBy('id')->get()->all(),
        'updates' => DB::table('build_updates')->where('vehicle_id', $targets['vehicle']->id)->get()->all(),
    ];
}

/**
 * @param  array<array-key, mixed>  $json
 * @return list<string>
 */
function gaKeys(array $json): array
{
    $keys = [];

    foreach ($json as $key => $value) {
        if (is_string($key)) {
            $keys[] = $key;
        }

        if (is_array($value)) {
            $keys = [...$keys, ...gaKeys($value)];
        }
    }

    return $keys;
}

/**
 * @param  array<string, mixed>  $parameters
 */
function gaCursor(array $parameters): string
{
    return rtrim(strtr(base64_encode((string) json_encode([...$parameters, '_pointsToNextItems' => true])), '+/', '-_'), '=');
}

describe('every object route', function () {
    it('gives the owner what it promises, so the refusals below mean something', function () {
        Sanctum::actingAs($this->owner);

        foreach (gaObjectRoutes() as $name => $route) {
            if ($route['success'] === null) {
                continue;
            }

            $response = gaCall($route, gaTargets($this->owner));

            expect($response->getStatusCode())->toBe($route['success'], $name.': '.$response->getContent());
        }
    });

    it('refuses a stranger and a block in either direction, and changes nothing', function (Closure $setup) {
        [$targets, $member] = $setup($this->owner);
        $before = gaState($targets);
        Sanctum::actingAs($member);

        foreach (gaObjectRoutes() as $name => $route) {
            $response = gaCall($route, $targets);

            expect($response->getStatusCode())->toBe($route['stranger'], $name.': '.$response->getContent())
                ->and((string) $response->getContent())->not->toContain('GEHEIME-NOTIZ')->not->toContain('VERSTECKTE-NOTIZ')->not->toContain('7654321');
        }

        expect(gaState($targets))->toEqual($before);
    })->with([
        'a stranger, on a private vehicle' => [fn (User $owner): array => [gaTargets($owner, ['visibility' => 'private']), User::factory()->create()]],
        'a member the owner blocked' => [function (User $owner): array {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return [gaTargets($owner), $member];
        }],
        'a member who blocked the owner' => [function (User $owner): array {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return [gaTargets($owner), $member];
        }],
    ]);

    it('lets a stranger read a public vehicle but write nothing', function () {
        $targets = gaTargets($this->owner);
        $before = gaState($targets);
        Sanctum::actingAs(User::factory()->create());

        foreach (gaObjectRoutes() as $name => $route) {
            $expected = $route['method'] === 'GET' ? 200 : $route['stranger'];

            expect(gaCall($route, $targets)->getStatusCode())->toBe($expected, $name);
        }

        expect(gaState($targets))->toEqual($before);
    });

    it('answers a guest 401 before anything else', function () {
        $targets = gaTargets($this->owner);
        $before = gaState($targets);

        foreach (gaObjectRoutes() as $name => $route) {
            $response = gaCall($route, $targets);

            expect($response->getStatusCode())->toBe(401, $name)->and($response->json('code'))->toBe('unauthenticated');
        }

        expect(gaState($targets))->toEqual($before);
    });

    it('does not take a staff session for a member', function () {
        $targets = gaTargets($this->owner);
        $before = gaState($targets);
        $this->actingAs(Staff::factory()->create(), 'staff');

        foreach (gaObjectRoutes() as $name => $route) {
            expect(gaCall($route, $targets)->getStatusCode())->toBe(401, $name);
        }

        expect(gaState($targets))->toEqual($before);
    });

    it('lets a member who must replace the password do nothing with their own vehicle', function () {
        $targets = gaTargets($this->owner);
        $before = gaState($targets);
        $this->owner->forceFill(['force_password_change' => true])->save();
        Sanctum::actingAs($this->owner);

        foreach (gaObjectRoutes() as $name => $route) {
            $response = gaCall($route, $targets);

            expect($response->getStatusCode())->toBe(403, $name)
                ->and($response->json('code'))->toBe('password_change_required', $name)
                ->and((string) $response->getContent())->not->toContain('GEHEIME-NOTIZ');
        }

        expect(gaState($targets))->toEqual($before);
    });

    it('stays closed under a restriction or a suspension, and open for reading and taking down', function (Closure $member) {
        $owner = $member();
        Sanctum::actingAs($owner);

        foreach (gaObjectRoutes() as $name => $route) {
            $targets = gaTargets($owner);
            $before = gaState($targets);
            $response = gaCall($route, $targets);

            if ($route['restriction'] === 'closed') {
                expect($response->getStatusCode())->toBe(403, $name)
                    ->and($response->json('code'))->toBe('account_restricted', $name)
                    ->and(gaState($targets))->toEqual($before);
            } else {
                expect($response->getStatusCode())->toBe($route['success'], $name);
            }
        }
    })->with([
        'publishing restriction' => [fn (): User => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'suspension' => [fn (): User => User::factory()->suspended()->create()],
    ]);

    it('holds nothing of the owner\'s for a stranger who may read the vehicle', function () {
        $targets = gaTargets($this->owner, ['hu_au_due' => '2027-03-01']);
        $vehicle = $targets['vehicle'];
        Sanctum::actingAs(User::factory()->create());

        foreach (["/vehicles/{$vehicle->id}", "/vehicles/{$vehicle->id}/mods", "/mods/{$targets['mod']->id}", "/vehicles/{$vehicle->id}/updates"] as $url) {
            $response = $this->getJson('/api/v1'.$url)->assertOk();

            expect(array_intersect(gaKeys($response->json()), ['email', 'password', 'owner_id', 'cost_cents', 'payload', 'open_until', 'moderation_status', 'disk', 'original_path', 'restrictions', 'force_password_change', 'previous_username']))->toBe([]);

            foreach ([$this->owner->email, '7654321', '76.543', 'GEHEIME-NOTIZ', 'VERSTECKTE-NOTIZ', '2027-03'] as $secret) {
                expect((string) $response->getContent())->not->toContain($secret);
            }
        }
    });
});

describe('states reached through the API', function () {
    it('does not republish an archived vehicle, which stays out of sight', function () {
        $vehicle = Vehicle::factory()->archived()->create(['owner_id' => $this->owner->id, 'model_year' => 2020]);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id]);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish");
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'public']);
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/main")->assertForbidden();

        expect($vehicle->refresh()->status)->toBe(VehicleStatus::Archived)
            ->and($vehicle->qrCodes()->count())->toBe(0)
            ->and($vehicle->is_main)->toBeFalse();

        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug()."/mods/{$mod->id}")->assertNotFound();
        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertNotFound();
        $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk()->assertJsonPath('data', []);
    });

    it('closes every route the moment a vehicle goes private, and shows it again by choice', function () {
        $targets = gaTargets($this->owner);
        $vehicle = $targets['vehicle'];
        $mod = $targets['mod'];
        $slug = $vehicle->canonicalSlug();
        $stranger = User::factory()->create();
        $publicUrls = ["/public/vehicles/{$slug}", "/public/vehicles/{$slug}/mods/{$mod->id}", "/public/vehicles/{$slug}/updates"];
        $memberUrls = ["/vehicles/{$vehicle->id}", "/vehicles/{$vehicle->id}/mods", "/mods/{$mod->id}", "/vehicles/{$vehicle->id}/updates"];

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();

        Sanctum::actingAs($stranger);

        foreach ([...$publicUrls, ...$memberUrls] as $url) {
            $this->getJson('/api/v1'.$url)->assertNotFound();
        }

        $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk()->assertJsonPath('data', []);

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'unlisted'])->assertOk();

        Sanctum::actingAs($stranger);

        foreach ([...$publicUrls, ...$memberUrls] as $url) {
            $this->getJson('/api/v1'.$url)->assertOk();
        }

        $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk()->assertJsonPath('data', []);
    });

    it('takes a cost off every route the moment it stops being public', function () {
        $targets = gaTargets($this->owner);
        $slug = $targets['vehicle']->canonicalSlug();
        $mod = $targets['mod'];
        $urls = ["/public/vehicles/{$slug}", "/public/vehicles/{$slug}/mods/{$mod->id}"];
        $stranger = User::factory()->create();

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/mods/{$mod->id}", ['cost_public' => true])->assertOk();

        Sanctum::actingAs($stranger);

        foreach ($urls as $url) {
            expect((string) $this->getJson('/api/v1'.$url)->assertOk()->getContent())->toContain('7654321');
        }

        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/mods/{$mod->id}", ['cost_public' => false])->assertOk();

        Sanctum::actingAs($stranger);

        foreach ([...$urls, "/public/vehicles/{$slug}/updates", "/mods/{$mod->id}", "/vehicles/{$targets['vehicle']->id}/mods"] as $url) {
            expect((string) $this->getJson('/api/v1'.$url)->assertOk()->getContent())->not->toContain('7654321');
        }
    });

    it('keeps a former username from reaching across a block, on either side', function (Closure $block) {
        $this->owner->forceFill(['username' => 'neuer.name', 'previous_username' => 'alter.name', 'username_changed_at' => now()])->save();
        publishedVehicle($this->owner);
        $member = User::factory()->create();
        $block($member, $this->owner);
        Sanctum::actingAs($member);

        foreach (['alter.name', 'neuer.name'] as $name) {
            $this->getJson("/api/v1/public/users/{$name}")->assertNotFound();
            $this->getJson("/api/v1/public/users/{$name}/vehicles")->assertNotFound();
        }
    })->with([
        'the target blocked' => [fn (User $member, User $target) => Block::factory()->create(['blocker_id' => $target->id, 'blocked_id' => $member->id])],
        'the member blocked' => [fn (User $member, User $target) => Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $target->id])],
    ]);

    it('answers a follow of anybody hidden exactly like a name nobody has', function () {
        $member = User::factory()->create();
        User::factory()->unverified()->create(['username' => 'ungeprueft']);
        User::factory()->suspended()->create(['username' => 'gesperrt']);
        User::factory()->deactivated()->create(['username' => 'abgemeldet']);
        Block::factory()->create(['blocker_id' => User::factory()->create(['username' => 'sperrt.mich'])->id, 'blocked_id' => $member->id]);
        Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => User::factory()->create(['username' => 'gesperrt.von.mir'])->id]);
        Sanctum::actingAs($member);

        $nothing = $this->postJson('/api/v1/users/niemand/follow')->assertNotFound()->getContent();

        foreach (['ungeprueft', 'gesperrt', 'abgemeldet', 'sperrt.mich', 'gesperrt.von.mir'] as $name) {
            expect($this->postJson("/api/v1/users/{$name}/follow")->assertNotFound()->getContent())->toBe($nothing);
        }

        expect($member->following()->count())->toBe(0);
    });
});

describe('what a client can send', function () {
    it('does not reach another member through query parameters or a forged cursor', function () {
        $mine = publishedVehicle($this->owner);
        $theirs = publishedVehicle(User::factory()->create(), ['visibility' => 'private']);
        Sanctum::actingAs($this->owner);

        $ids = $this->getJson("/api/v1/me/vehicles?owner_id={$theirs->owner_id}&user_id={$theirs->owner_id}&id={$theirs->id}")->assertOk()->json('data.*.id');
        expect($ids)->toBe([$mine->id]);

        $forged = gaCursor(['is_main' => 1, 'sort' => 999999, 'id' => '00000000000000000000000000']);
        $ids = $this->getJson("/api/v1/me/vehicles?cursor={$forged}")->assertOk()->json('data.*.id');
        expect($ids)->not->toContain($theirs->id);
    });

    it('does not uncover a hidden entry with a cursor or a parameter', function () {
        $vehicle = publishedVehicle($this->owner);
        $visible = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => false]);
        $hidden = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => true]);
        $forged = gaCursor(['created_at' => '2999-01-01 00:00:00', 'id' => 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ']);

        foreach (['?hidden=1', '?include_hidden=1&hidden=true', "?cursor={$forged}"] as $query) {
            $ids = $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates'.$query)->assertOk()->json('data.*.id');

            expect($ids)->toBe([$visible->id])->not->toContain($hidden->id);
        }
    });

    it('keeps only what the schema knows in the stored fields', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        foreach (['title' => 'x', 'status' => 'planned', 'cost_public' => true, 'notes' => 'x'] as $key => $value) {
            $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => ['diameter' => 19, $key => $value]])
                ->assertUnprocessable()->assertJsonValidationErrorFor("fields.$key");
        }

        $this->call('POST', "/api/v1/vehicles/{$vehicle->id}/mods", [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], '{"category":"wheels_tires","fields":{"diameter":-1e999}}')
            ->assertUnprocessable();

        $id = $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => ['diameter' => 19, 'wheel_brand' => null]])->assertCreated()->json('data.id');

        expect(Modification::query()->findOrFail($id)->getAttribute('fields'))->toBe(['diameter' => 19]);
    });

    it('cannot make a slug point at another vehicle', function () {
        $other = publishedVehicle(User::factory()->create(), ['visibility' => 'private']);
        Sanctum::actingAs($this->owner);

        $id = $this->postJson('/api/v1/vehicles', ['make_text' => 'Marke '.$other->public_id, 'model_text' => '../../'.$other->canonicalSlug()])->assertCreated()->json('data.id');
        $vehicle = Vehicle::query()->findOrFail($id);

        expect($vehicle->slug)->toMatch('/\A[a-z0-9-]+\z/')
            ->and(Slug::publicId($vehicle->slug))->toBe($vehicle->public_id)
            ->and(Vehicle::findBySlug($vehicle->slug)?->id)->toBe($vehicle->id);
    });

    it('renders markup and translation placeholders in a title as the text they are', function () {
        $vehicle = publishedVehicle($this->owner);
        $title = '<script>alert(1)</script> :title :Title :count :field';
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'exhaust', 'title' => $title, 'status' => 'planned'])->assertCreated();

        $summary = $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates')->assertOk()->assertHeader('Content-Type', 'application/json')->json('data.0.summary');

        expect($summary)->toContain($title);
    });

    it('prints no public Blade view unescaped', function () {
        foreach (File::allFiles(resource_path('views/public')) as $view) {
            expect($view->getContents())->not->toContain('{!!');
        }
    });
});

describe('limits', function () {
    it('count per member, so one member cannot use up another\'s', function (string $limit, Closure $request) {
        config(["speedclub.rate_limits.$limit.max" => 1]);
        RateLimits::register();
        $first = User::factory()->create();
        $second = User::factory()->create();

        Sanctum::actingAs($first);
        $request();
        $request()->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');

        Sanctum::actingAs($second);
        expect($request()->getStatusCode())->not->toBe(429);
    })->with([
        'creating' => ['garage_writes', fn () => test()->postJson('/api/v1/vehicles')],
        'reordering' => ['garage_reorders', fn () => test()->putJson('/api/v1/me/vehicles/order', ['ids' => ['keine-ulid']])],
    ]);
});

describe('photos of a modification', function () {
    it('lose GPS and the file name on the way in, and the original stays private', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $source = TestImages::jpegWithGps(800, 600);
        Sanctum::actingAs($this->owner);

        expect($source)->toContain('Exif');

        $response = $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('../../geheim.php.jpg', $source)], ['Accept' => 'application/json'])->assertCreated();
        $media = Media::query()->findOrFail($response->json('data.id'));
        $public = Storage::disk('public')->allFiles('media/'.strtolower($media->id));
        $private = Storage::disk('local')->allFiles();

        expect($public)->not->toBe([])
            ->and($private)->not->toBe([])
            ->and((string) $response->getContent())->not->toContain('original')->not->toContain('geheim');

        foreach ($public as $path) {
            expect($path)->toEndWith('.webp')->not->toContain('geheim')
                ->and((string) Storage::disk('public')->get($path))->not->toContain('Exif')->not->toContain('GPS');
        }

        foreach ($private as $path) {
            expect($path)->not->toContain('geheim')
                ->and((string) Storage::disk('local')->get($path))->not->toContain('Exif');
        }
    });

    it('stay away from others when rejected, also as the only photo of the row', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $rejected = Media::factory()->forModel($mod)->create(['owner_id' => $this->owner->id, 'moderation_status' => ModerationStatus::Rejected]);

        foreach (['', "/mods/{$mod->id}"] as $suffix) {
            expect((string) $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().$suffix)->assertOk()->getContent())->not->toContain($rejected->id);
        }
    });
});

describe('queued jobs', function () {
    it('carry ids and nothing else, every one of them', function () {
        $jobs = collect(File::allFiles(app_path()))
            ->filter(fn ($file): bool => preg_match('/implements [^{]*ShouldQueue/', $file->getContents()) === 1)
            ->map(fn ($file): string => 'App\\'.str_replace(['/', '.php'], ['\\', ''], Str::after(str_replace('\\', '/', $file->getPathname()), 'app/')));

        expect($jobs->count())->toBeGreaterThanOrEqual(2);

        foreach ($jobs as $job) {
            $class = new ReflectionClass($job);

            expect($class->implementsInterface(ShouldQueue::class))->toBeTrue();

            foreach ($class->getConstructor()?->getParameters() ?? [] as $parameter) {
                expect((string) $parameter->getType())->toBeIn(['string', 'int'], $job)
                    ->and($parameter->getName())->toEndWith('Id');
            }
        }
    });
});
