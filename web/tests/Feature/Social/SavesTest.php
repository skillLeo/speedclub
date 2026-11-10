<?php

use App\Http\Middleware\Idempotency;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SocialTestHelpers.php';

/**
 * M2.1 saves [SIG sig.saved_builds] (contract §4): POST/DELETE vehicles/{vehicle}/save, GET me/saved, PublicVehicleResource.is_saved.
 */
beforeEach(function () {
    socSavesOn();
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->viewer = User::factory()->create(['username' => 'lukas.sc']);
    $this->vehicle = publishedVehicle($this->owner);
});

function socSaveUrl(string $id): string
{
    return "/api/v1/vehicles/$id/save";
}

describe('POST vehicles/{vehicle}/save', function () {
    it('saves, idempotently, and answers the state', function () {
        Sanctum::actingAs($this->viewer);

        $this->postJson(socSaveUrl($this->vehicle->id))->assertOk()->assertExactJson(['data' => ['vehicle_id' => $this->vehicle->id, 'is_saved' => true]]);
        $this->postJson(socSaveUrl($this->vehicle->id))->assertOk()->assertJsonPath('data.is_saved', true);

        expect(Save::query()->where('user_id', $this->viewer->id)->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('saves an unlisted build, as its page is reachable by link', function () {
        $unlisted = publishedVehicle($this->owner, ['visibility' => 'unlisted']);
        Sanctum::actingAs($this->viewer);

        $this->postJson(socSaveUrl($unlisted->id))->assertOk();
    });

    it('refuses the own vehicle with 403', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson(socSaveUrl($this->vehicle->id))->assertForbidden()->assertJsonPath('code', 'forbidden');
        expect(Save::query()->count())->toBe(0);
    });

    it('answers 404 vehicle_unavailable for anything the viewer may not view, as the vehicle page does', function (Closure $state) {
        $id = $state($this->vehicle, $this->viewer);
        Sanctum::actingAs($this->viewer);

        $this->postJson(socSaveUrl($id))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        expect(Save::query()->count())->toBe(0);
    })->with([
        'private' => [function (Vehicle $v) {
            $v->forceFill(['visibility' => 'private'])->save();

            return $v->id;
        }],
        'draft' => [fn (Vehicle $v) => Vehicle::factory()->create(['owner_id' => $v->owner_id])->id],
        'deleted' => [function (Vehicle $v) {
            $v->delete();

            return $v->id;
        }],
        'nothing there' => [fn () => '01JAAAAAAAAAAAAAAAAAAAAAAA'],
        'not an id at all' => [fn () => 'kaputt'],
        'owner suspended' => [function (Vehicle $v) {
            $v->owner->forceFill(['status' => 'suspended'])->save();

            return $v->id;
        }],
        'owner unverified' => [function (Vehicle $v) {
            $v->owner->forceFill(['email_verified_at' => null])->save();

            return $v->id;
        }],
        'owner blocked the viewer' => [function (Vehicle $v, User $viewer) {
            socBlock($v->owner, $viewer);

            return $v->id;
        }],
        'viewer blocked the owner' => [function (Vehicle $v, User $viewer) {
            socBlock($viewer, $v->owner);

            return $v->id;
        }],
    ]);

    it('is open by who asks, no verification needed (ADR-139)', function (Closure $viewer, int $status, ?string $code) {
        socActAs($viewer($this->owner));

        $response = $this->postJson(socSaveUrl($this->vehicle->id))->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [403, 'forbidden'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'vehicle_unavailable'],
        'member the other blocked' => [404, 'vehicle_unavailable'],
    ]));

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs($this->viewer);
        $headers = [Idempotency::HEADER => 'save-1'];

        $this->postJson(socSaveUrl($this->vehicle->id), [], $headers)->assertOk();
        $this->postJson(socSaveUrl($this->vehicle->id), [], $headers)->assertOk()->assertHeader(Idempotency::REPLAYED_HEADER);
    });

    it('is limited to 300 a day, saves and unsaves together', function () {
        socLimit('saves');
        Sanctum::actingAs($this->viewer);

        $this->postJson(socSaveUrl($this->vehicle->id))->assertOk();
        $this->withHeader('Accept-Language', 'de')->deleteJson(socSaveUrl($this->vehicle->id))->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Du hast heute schon sehr viele Builds gespeichert oder entfernt.'));
    });

    it('carries member, the flag, throttle:saves and idempotent, and not verified-member', function () {
        expect(Route::getRoutes()->getByName('api.v1.saves.store')?->gatherMiddleware())->toContain('member', 'throttle:saves', 'idempotent')->not->toContain('verified-member')
            ->and(config('speedclub.rate_limits.saves'))->toBe(['max' => 300, 'minutes' => 1440]);
    });
});

describe('DELETE vehicles/{vehicle}/save', function () {
    it('unsaves and answers 200 for any id, also for a build that went away', function () {
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $this->vehicle->id]);
        $this->vehicle->delete();
        Sanctum::actingAs($this->viewer);

        $this->deleteJson(socSaveUrl($this->vehicle->id))->assertOk()->assertExactJson(['data' => ['vehicle_id' => $this->vehicle->id, 'is_saved' => false]]);
        $this->deleteJson(socSaveUrl('01JAAAAAAAAAAAAAAAAAAAAAAA'))->assertOk()->assertJsonPath('data.is_saved', false);

        expect(Save::query()->count())->toBe(0);
    });

    it('removes only the own save', function () {
        $other = User::factory()->create();
        Save::factory()->create(['user_id' => $other->id, 'vehicle_id' => $this->vehicle->id]);
        Sanctum::actingAs($this->viewer);

        $this->deleteJson(socSaveUrl($this->vehicle->id))->assertOk();
        expect(Save::query()->where('user_id', $other->id)->count())->toBe(1);
    });

    it('is open by who asks', function (Closure $viewer, int $status, ?string $code) {
        socActAs($viewer($this->owner));

        $response = $this->deleteJson(socSaveUrl($this->vehicle->id))->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));
});

describe('GET me/saved', function () {
    it('lists the member\'s saves newest first, as feed cards with saved_at', function () {
        $older = publishedVehicle(User::factory()->create());
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $older->id, 'created_at' => '2026-09-01 10:00:00']);
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $this->vehicle->id, 'created_at' => '2026-10-01 10:00:00']);
        Save::factory()->create(['user_id' => User::factory()->create()->id, 'vehicle_id' => $older->id]);
        Sanctum::actingAs($this->viewer);

        $response = $this->getJson('/api/v1/me/saved')->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$this->vehicle->id, $older->id])
            ->and($response->json('data.0.saved_at'))->toBe('2026-10-01T10:00:00+00:00')
            ->and($response->json('data.0.owner.username'))->toBe('jann.ptrs')
            ->and($response->json('data.0'))->toHaveKeys(['title', 'full_title', 'spec_strip', 'cover', 'mod_count', 'latest_update'])
            ->and($response->json('data.0.completeness'))->toBeNull();
    });

    it('leaves out builds the member can no longer view, keeps their saves, and shows them again when they come back', function (Closure $hide, Closure $restore) {
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $this->vehicle->id]);
        $hide($this->vehicle, $this->viewer);
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/saved')->assertOk()->assertJsonCount(0, 'data');
        expect(Save::query()->count())->toBe(1);

        $restore($this->vehicle);
        $this->getJson('/api/v1/me/saved')->assertOk()->assertJsonCount(1, 'data');
    })->with([
        'went private' => [fn (Vehicle $v) => $v->forceFill(['visibility' => 'private'])->save(), fn (Vehicle $v) => $v->forceFill(['visibility' => 'public'])->save()],
        'deleted' => [fn (Vehicle $v) => $v->delete(), fn (Vehicle $v) => $v->restore()],
        'owner suspended' => [fn (Vehicle $v) => $v->owner->forceFill(['status' => 'suspended'])->save(), fn (Vehicle $v) => $v->owner->forceFill(['status' => 'active'])->save()],
        'owner deactivated' => [fn (Vehicle $v) => $v->owner->forceFill(['status' => 'deactivated'])->save(), fn (Vehicle $v) => $v->owner->forceFill(['status' => 'active'])->save()],
        'across a block' => [fn (Vehicle $v, User $viewer) => socBlock($viewer, $v->owner), fn () => Block::query()->delete()],
    ]);

    it('keeps an unlisted build in the list', function () {
        $unlisted = publishedVehicle($this->owner, ['visibility' => 'unlisted']);
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $unlisted->id]);
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/saved')->assertOk()->assertJsonPath('data.0.id', $unlisted->id);
    });

    it('pages with a cursor', function () {
        foreach (range(1, 3) as $i) {
            Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => publishedVehicle($this->owner, ['nickname' => "n$i"])->id, 'created_at' => "2026-10-0{$i} 10:00:00"]);
        }

        Sanctum::actingAs($this->viewer);

        $first = $this->getJson('/api/v1/me/saved?per_page=2')->assertOk();
        $second = $this->getJson('/api/v1/me/saved?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect([...array_column($first->json('data'), 'nickname'), ...array_column($second->json('data'), 'nickname')])->toBe(['n3', 'n2', 'n1'])
            ->and($second->json('meta.next_cursor'))->toBeNull();
    });

    it('refuses a bad page size or cursor', function (string $query, string $field) {
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/saved?'.$query)->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'per_page 51' => ['per_page=51', 'per_page'],
        'cursor of another list' => ['cursor='.rtrim(strtr(base64_encode((string) json_encode(['blocks.created_at' => '2026-01-01', 'blocks.id' => 1, '_pointsToNextItems' => true])), '+/', '-_'), '='), 'cursor'],
    ]);

    it('is open by who asks', function (Closure $viewer, int $status, ?string $code) {
        socActAs($viewer($this->owner));

        $response = $this->getJson('/api/v1/me/saved')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));
});

describe('while sig.saved_builds is off', function () {
    beforeEach(fn () => socSavesOn(false));

    it('answers 404 feature_disabled on all three routes and changes nothing', function (string $method, Closure $url) {
        Sanctum::actingAs($this->viewer);

        $this->json($method, $url($this->vehicle))->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        expect(Save::query()->count())->toBe(0);
    })->with([
        'save' => ['POST', fn (Vehicle $v) => socSaveUrl($v->id)],
        'unsave' => ['DELETE', fn (Vehicle $v) => socSaveUrl($v->id)],
        'list' => ['GET', fn () => '/api/v1/me/saved'],
    ]);

    it('answers 404 feature_disabled when the flag row does not exist at all', function () {
        FeatureFlag::query()->where('key', 'sig.saved_builds')->delete();
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/saved')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('treats a partial rollout as off, as the clients do', function () {
        FeatureFlag::query()->where('key', 'sig.saved_builds')->update(['enabled' => true, 'rules' => ['percentage' => 50]]);
        Sanctum::actingAs($this->viewer);

        $this->postJson(socSaveUrl($this->vehicle->id))->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('still tells a guest 401 first', function () {
        $this->getJson('/api/v1/me/saved')->assertUnauthorized();
    });

    it('gives is_saved null on the vehicle page', function () {
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $this->vehicle->id]);
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk()->assertJsonPath('data.is_saved', null);
    });
});

describe('PublicVehicleResource.is_saved', function () {
    it('is null for guests and the owner, and the state for anybody else', function () {
        $url = '/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug();

        $this->getJson($url)->assertOk()->assertJsonPath('data.is_saved', null);

        Sanctum::actingAs($this->owner);
        $this->getJson($url)->assertOk()->assertJsonPath('data.is_saved', null);

        app('auth')->forgetGuards();
        Sanctum::actingAs($this->viewer);
        $this->getJson($url)->assertOk()->assertJsonPath('data.is_saved', false);

        $this->postJson(socSaveUrl($this->vehicle->id))->assertOk();
        $this->getJson($url)->assertOk()->assertJsonPath('data.is_saved', true);
    });
});
