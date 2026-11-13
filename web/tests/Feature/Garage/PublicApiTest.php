<?php

use App\Enums\PowerDisplay;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'city' => 'Stuttgart']);
});

function vehicleWithSpecs(User $owner, array $attributes = []): Vehicle
{
    $vehicle = publishedVehicle($owner, $attributes);
    $specs = new VehicleSpec(['vehicle_id' => $vehicle->id, 'engine_code' => 'RB26DETT', 'engine_text' => '2,6 l R6 Biturbo', 'displacement_cc' => 2568, 'torque_nm' => 540, 'torque_source' => 'measured', 'drivetrain' => 'all', 'gearbox' => 'manual', 'fuel' => 'petrol']);
    $specs->setPower(500, PowerUnit::Ps, PowerSource::Measured)->save();

    return $vehicle;
}

function publicUrl(Vehicle $vehicle, string $suffix = ''): string
{
    return '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().$suffix;
}

describe('GET public/vehicles/{slug}', function () {
    it('gives a guest what FS-3 displays, in PS (kW)', function () {
        $vehicle = vehicleWithSpecs($this->owner, ['color' => 'Bayside Blue']);
        modIn($vehicle, 'wheels_tires', ['diameter' => 18, 'width_front' => 9.5, 'et_front' => 22, 'tyre_size_front' => '265/35 R18'], ['title' => 'Rays TE37', 'sort' => 1]);
        modIn($vehicle, 'suspension', ['type' => 'coilover', 'lowering_front' => 35], ['title' => 'KW V3', 'sort' => 2]);
        modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS', 'sort' => 3]);
        modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'Geplant', 'status' => 'planned', 'sort' => 4]);

        $response = $this->withHeader('Accept-Language', 'de')->getJson(publicUrl($vehicle))->assertOk()
            ->assertJsonPath('data.public_id', $vehicle->public_id)
            ->assertJsonPath('data.spec_strip.0', ['key' => 'power', 'value' => '500', 'unit' => 'PS', 'label' => 'PS'])
            ->assertJsonPath('data.spec_strip.1', ['key' => 'torque', 'value' => '540', 'unit' => 'Nm', 'label' => 'Nm'])
            ->assertJsonPath('data.spec_strip.2.label', 'Baujahr')
            ->assertJsonPath('data.spec_strip.3', ['key' => 'drivetrain', 'value' => 'AWD', 'unit' => null, 'label' => 'Antrieb'])
            ->assertJsonPath('data.power.label', '500 PS (368 kW)')
            ->assertJsonPath('data.power.source_label', 'Prüfstand')
            ->assertJsonPath('data.torque.label', '540 Nm')
            ->assertJsonPath('data.subline_parts.1', '2,6 l R6 Biturbo (RB26DETT)')
            ->assertJsonPath('data.subline_parts.2', 'Bayside Blue')
            ->assertJsonPath('data.mods.count', 4)
            ->assertJsonPath('data.owner.username', 'lukas.sc')
            ->assertJsonPath('data.owner.is_following', false)
            ->assertJsonPath('data.is_owner', false)
            ->assertJsonPath('data.completeness', null)
            ->assertJsonPath('data.qr', null)
            ->assertJsonPath('data.photo_count', 1)
            ->assertHeader('ETag');

        expect(array_column($response->json('data.highlights'), 'title'))->toBe(['Rays TE37', 'KW V3', 'HKS'])
            ->and($response->json('data.highlights.0.summary_line'))->toBe("Rays TE37 · 18\u{2033} \u{00D7} 9,5J ET22 · 265/35 R18")
            ->and(array_column($response->json('data.mods.groups'), 'count'))->toBe([1, 1, 2])
            ->and($response->json('data.mods.groups.0.category.key'))->toBe('wheels_tires')
            ->and($response->json('data.spec_groups.*.key'))->toBe(['vehicle', 'engine', 'power', 'drivetrain'])
            ->and($response->json('data.owner.stats.vehicles'))->toBe(1);
    });

    it('follows the viewer\'s power setting', function (PowerDisplay $display, array $strip, string $label) {
        $vehicle = vehicleWithSpecs($this->owner);
        Sanctum::actingAs(User::factory()->create(['power_display' => $display]));

        $this->withHeader('Accept-Language', 'de')->getJson(publicUrl($vehicle))->assertOk()
            ->assertJsonPath('data.spec_strip.0.value', $strip[0])
            ->assertJsonPath('data.spec_strip.0.unit', $strip[1])
            ->assertJsonPath('data.power.label', $label);
    })->with([
        'kW (PS)' => [PowerDisplay::KwPs, ['368', 'kW'], '368 kW (500 PS)'],
        'hp' => [PowerDisplay::Hp, ['493', 'hp'], '493 hp'],
    ]);

    it('answers 301 to the canonical address whatever the text part says', function () {
        $vehicle = publishedVehicle($this->owner);

        $this->getJson('/api/v1/public/vehicles/irgendein-text-'.strtolower($vehicle->public_id))
            ->assertStatus(301)
            ->assertHeader('Location', url(publicUrl($vehicle)));

        $this->getJson('/api/v1/public/vehicles/'.$vehicle->public_id)->assertStatus(301);
    });

    it('keeps its 301 out of the browser cache, as a name can come back', function () {
        $vehicle = publishedVehicle($this->owner);

        $response = $this->getJson('/api/v1/public/vehicles/irgendein-text-'.strtolower($vehicle->public_id))->assertStatus(301);

        expect($response->headers->get('Cache-Control'))->toContain('no-cache')
            ->and($response->headers->get('Cache-Control'))->toContain('private');
    });

    it('revalidates with its ETag', function () {
        $vehicle = publishedVehicle($this->owner);

        $tag = $this->getJson(publicUrl($vehicle))->assertOk()->headers->get('ETag');

        $this->withHeader('If-None-Match', $tag)->getJson(publicUrl($vehicle))->assertStatus(304);
    });

    it('answers vehicle_unavailable the same way for everything hidden, without leaking', function (Closure $vehicle, ?Closure $viewer) {
        $target = $vehicle($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer($target));
        }

        $response = $this->getJson(publicUrl($target))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        $missing = $this->getJson('/api/v1/public/vehicles/nichts-ZZZZZZZZ')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        expect($response->json())->toBe($missing->json());
    })->with([
        'private, guest' => [fn (User $o) => Vehicle::factory()->private()->create(['owner_id' => $o->id]), null],
        'private, other member' => [fn (User $o) => Vehicle::factory()->private()->create(['owner_id' => $o->id]), fn () => User::factory()->create()],
        'draft, guest' => [fn (User $o) => Vehicle::factory()->create(['owner_id' => $o->id]), null],
        'archived, guest' => [fn (User $o) => Vehicle::factory()->archived()->create(['owner_id' => $o->id]), null],
        'deleted, guest' => [function (User $o) {
            $vehicle = publishedVehicle($o);
            $vehicle->delete();

            return $vehicle;
        }, null],
        'deleted, owner' => [function (User $o) {
            $vehicle = publishedVehicle($o);
            $vehicle->delete();

            return $vehicle;
        }, fn (Vehicle $v) => $v->owner],
        'owner blocked the viewer' => [fn (User $o) => publishedVehicle($o), function (Vehicle $v) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $v->owner_id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }],
        'viewer blocked the owner' => [fn (User $o) => publishedVehicle($o), function (Vehicle $v) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $v->owner_id]);

            return $viewer;
        }],
        'suspended owner' => [fn (User $o) => publishedVehicle(User::factory()->suspended()->create()), null],
        'unverified owner' => [fn (User $o) => publishedVehicle(User::factory()->unverified()->create()), null],
        'deactivated owner' => [fn (User $o) => publishedVehicle(User::factory()->deactivated()->create()), null],
    ]);

    it('shows an unlisted vehicle by its link, and a private one to its owner only', function () {
        $unlisted = publishedVehicle($this->owner, ['visibility' => 'unlisted']);
        $private = publishedVehicle($this->owner, ['visibility' => 'private']);

        $this->getJson(publicUrl($unlisted))->assertOk();

        Sanctum::actingAs($this->owner);

        $this->getJson(publicUrl($private))->assertOk()
            ->assertJsonPath('data.is_owner', true)
            ->assertJsonPath('data.owner.is_self', true)
            ->assertJsonStructure(['data' => ['completeness' => ['percent']]]);
    });

    it('takes a staff session and a member with a forced password change for a guest', function () {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'private']);

        $this->actingAs(Staff::factory()->create(), 'staff');
        $this->getJson(publicUrl($vehicle))->assertNotFound();

        $this->owner->forceFill(['force_password_change' => true])->save();
        app('auth')->forgetGuards();
        Sanctum::actingAs($this->owner);

        $this->getJson(publicUrl($vehicle))->assertNotFound();
    });

    it('keeps photos that are unfinished or rejected from others, but not from the owner', function () {
        $vehicle = publishedVehicle($this->owner);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'moderation_status' => 'rejected']);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'status' => 'processing']);

        $this->getJson(publicUrl($vehicle))->assertOk()->assertJsonPath('data.photo_count', 1)->assertJsonCount(1, 'data.photos');

        Sanctum::actingAs($this->owner);

        $this->getJson(publicUrl($vehicle))->assertOk()->assertJsonPath('data.photo_count', 3);
    });

    it('never leaks a cost that is not public, anywhere', function () {
        $vehicle = publishedVehicle($this->owner);
        $private = modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'Geheim', 'cost_cents' => 123456, 'notes' => null]);
        modIn($vehicle, 'brakes', [], ['title' => 'Offen', 'cost_cents' => 77700, 'cost_public' => true, 'sort' => 2]);
        BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);

        $urls = [publicUrl($vehicle), publicUrl($vehicle, "/mods/{$private->id}"), publicUrl($vehicle, '/updates'), '/api/v1/public/users/lukas.sc/vehicles'];

        foreach ($urls as $url) {
            expect($this->getJson($url)->assertOk()->getContent())->not->toContain('123456');
        }

        $page = $this->getJson(publicUrl($vehicle))->json('data');

        // M4.9 ruling: costs are never public, cost_public or not.
        expect(collect($page['mods']['groups'])->flatMap(fn (array $group) => $group['items'])->firstWhere('title', 'Offen')['cost'])->toBeNull()
            ->and(collect($page['mods']['groups'])->flatMap(fn (array $group) => $group['items'])->firstWhere('title', 'Geheim')['cost'])->toBeNull();

        $this->getJson(publicUrl($vehicle, "/mods/{$private->id}"))->assertJsonPath('data.cost', null)->assertJsonPath('data.fields', null);

        Sanctum::actingAs(User::factory()->create());

        expect($this->getJson(publicUrl($vehicle))->getContent())->not->toContain('123456');

        Sanctum::actingAs($this->owner);

        $this->getJson(publicUrl($vehicle, "/mods/{$private->id}"))->assertJsonPath('data.cost.cents', 123456);
    });

    it('keeps the private cost out of Verlauf as well', function () {
        Sanctum::actingAs($this->owner);
        $vehicle = publishedVehicle($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'exhaust', 'brand_text' => 'HKS', 'cost_cents' => 123456, 'fields' => []])->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/mods/$id", ['cost_cents' => 654321])->assertOk();

        expect(json_encode(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->pluck('payload')))->not->toContain('123456')->not->toContain('654321');
    });

    it('hides the legal status while its flag is off', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust', [], ['legal_status' => 'abe']);

        $this->getJson(publicUrl($vehicle, "/mods/{$mod->id}"))->assertJsonPath('data.legal_status', null);

        FeatureFlag::query()->create(['key' => 'sig.mod_legal_status', 'enabled' => true]);

        $this->getJson(publicUrl($vehicle, "/mods/{$mod->id}"))->assertJsonPath('data.legal_status', 'abe');
    });

    it('is rate limited per address for anonymous reads', function () {
        config(['speedclub.rate_limits.public_read.max' => 1]);
        RateLimits::register();
        $vehicle = publishedVehicle($this->owner);

        $this->getJson(publicUrl($vehicle))->assertOk();
        $this->getJson(publicUrl($vehicle))->assertTooManyRequests();
    });
});

describe('public modification and update detail', function () {
    it('shows a modification of this vehicle, not of another', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'suspension', ['type' => 'coilover', 'lowering_front' => 35], ['title' => 'KW V3']);
        $foreign = modIn(publishedVehicle(), 'exhaust');

        $this->withHeader('Accept-Language', 'de')->getJson(publicUrl($vehicle, "/mods/{$mod->id}"))->assertOk()
            ->assertJsonPath('data.title', 'KW V3')
            ->assertJsonPath('data.specs.0', ['key' => 'type', 'label' => 'Art', 'value' => 'Gewindefahrwerk'])
            ->assertJsonPath('data.specs.1', ['key' => 'lowering_front', 'label' => 'Tieferlegung vorne', 'value' => "\u{2212}35 mm"]);

        $this->getJson(publicUrl($vehicle, "/mods/{$foreign->id}"))->assertNotFound()->assertJsonPath('code', 'not_found');
    });

    it('shows a visible entry, and a hidden one to the owner only', function () {
        $vehicle = publishedVehicle($this->owner);
        $shown = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);
        $hidden = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'hidden' => true]);

        $this->getJson(publicUrl($vehicle, "/updates/{$shown->id}"))->assertOk()->assertJsonPath('data.id', $shown->id);
        $this->getJson(publicUrl($vehicle, "/updates/{$hidden->id}"))->assertNotFound()->assertJsonPath('code', 'not_found');

        $list = $this->getJson(publicUrl($vehicle, '/updates'))->assertOk();
        expect(array_column($list->json('data'), 'id'))->toBe([$shown->id]);

        $page = $this->getJson(publicUrl($vehicle))->assertOk();
        expect($page->json('data.updates_count'))->toBe(1)
            ->and(array_column($page->json('data.updates'), 'id'))->toBe([$shown->id]);

        Sanctum::actingAs($this->owner);

        $this->getJson(publicUrl($vehicle, "/updates/{$hidden->id}"))->assertOk()->assertJsonPath('data.hidden', true);
    });

    it('hides everything of a private vehicle through every sub-route', function (string $suffix) {
        $vehicle = publishedVehicle($this->owner, ['visibility' => 'private']);
        $mod = modIn($vehicle, 'exhaust');
        $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);
        $path = str_replace(['{mod}', '{update}'], [$mod->id, $update->id], $suffix);

        $this->getJson(publicUrl($vehicle, $path))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    })->with(['/mods/{mod}', '/updates', '/updates/{update}']);
});

describe('GET public/users/{username}', function () {
    it('shows the member with real numbers', function () {
        publishedVehicle($this->owner);
        publishedVehicle($this->owner, ['visibility' => 'unlisted']);
        User::factory()->count(2)->create()->each(fn (User $fan) => $fan->following()->attach($this->owner->id, ['created_at' => now()]));

        $this->getJson('/api/v1/public/users/LUKAS.SC')->assertOk()
            ->assertJsonPath('data.username', 'lukas.sc')
            ->assertJsonPath('data.stats', ['vehicles' => 1, 'followers' => 2, 'following' => 0])
            ->assertJsonPath('data.is_following', false)
            ->assertJsonPath('data.is_self', false)
            ->assertHeader('ETag')
            ->assertJsonMissingPath('data.email');
    });

    it('resolves an old username for 14 days, with the canonical name', function () {
        $this->owner->forceFill(['username' => 'neu.name', 'previous_username' => 'lukas.sc', 'username_changed_at' => now()->subDays(13)])->save();

        $this->getJson('/api/v1/public/users/lukas.sc')->assertOk()->assertJsonPath('data.username', 'neu.name');
        $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk();

        $this->travel(2)->days();

        $this->getJson('/api/v1/public/users/lukas.sc')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        $this->getJson('/api/v1/public/users/neu.name')->assertOk();
    });

    it('does not know members who are not public, or across a block', function (Closure $state) {
        $member = User::factory()->create(['username' => 'versteckt']);
        $viewer = $state($member);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        $this->getJson('/api/v1/public/users/versteckt')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        $this->getJson('/api/v1/public/users/versteckt/vehicles')->assertNotFound();
    })->with([
        'unverified' => [function (User $m) {
            $m->forceFill(['email_verified_at' => null])->save();

            return null;
        }],
        'suspended' => [function (User $m) {
            $m->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]])->save();

            return null;
        }],
        'deactivated' => [function (User $m) {
            $m->forceFill(['status' => 'deactivated'])->save();

            return null;
        }],
        'blocked by the member' => [function (User $m) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $m->id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }],
        'blocking the member' => [function (User $m) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $m->id]);

            return $viewer;
        }],
    ]);

    it('lists public vehicles only, main first', function () {
        $second = publishedVehicle($this->owner, ['sort' => 1]);
        $main = publishedVehicle($this->owner, ['sort' => 9, 'is_main' => true]);
        publishedVehicle($this->owner, ['visibility' => 'unlisted']);
        publishedVehicle($this->owner, ['visibility' => 'private']);
        Vehicle::factory()->create(['owner_id' => $this->owner->id]);

        $response = $this->getJson('/api/v1/public/users/lukas.sc/vehicles')->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$main->id, $second->id])
            ->and($response->json('data.0.completeness'))->toBeNull()
            ->and($response->json('data.0.qr'))->toBeNull();
    });
});

describe('POST and DELETE users/{username}/follow', function () {
    it('follows and unfollows, idempotently, with real counts', function () {
        $fan = User::factory()->create();
        Sanctum::actingAs($fan);

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertOk()
            ->assertJsonPath('data', ['username' => 'lukas.sc', 'is_following' => true, 'followers' => 1]);

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertOk()->assertJsonPath('data.followers', 1);

        expect($fan->following()->count())->toBe(1);

        $this->getJson('/api/v1/public/users/lukas.sc')->assertJsonPath('data.is_following', true);
        $this->getJson(publicUrl(publishedVehicle($this->owner)))->assertJsonPath('data.owner.is_following', true);

        $this->deleteJson('/api/v1/users/lukas.sc/follow')->assertOk()->assertJsonPath('data.is_following', false)->assertJsonPath('data.followers', 0);
        $this->deleteJson('/api/v1/users/lukas.sc/follow')->assertOk()->assertJsonPath('data.is_following', false);

        expect($fan->following()->count())->toBe(0);
    });

    it('refuses by who asks', function (Closure $viewer, int $status, ?string $code) {
        $member = $viewer($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $response = $this->postJson('/api/v1/users/lukas.sc/follow')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with([
        'guest' => [fn () => null, 401, 'unauthenticated'],
        'self' => [fn (User $o) => $o, 403, 'forbidden'],
        'unverified' => [fn () => User::factory()->unverified()->create(), 403, 'email_not_verified'],
        'suspended' => [fn () => User::factory()->suspended()->create(), 403, 'forbidden'],
        'blocked by the member' => [function (User $o) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $o->id, 'blocked_id' => $viewer->id]);

            return $viewer;
        }, 404, 'member_unavailable'],
        'blocking the member' => [function (User $o) {
            $viewer = User::factory()->create();
            Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $o->id]);

            return $viewer;
        }, 404, 'member_unavailable'],
    ]);

    it('lets a publishing restriction follow', function () {
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertOk();
    });

    it('does not know a member who is not public, and still lets go of one', function () {
        $fan = User::factory()->create();
        $fan->following()->attach($this->owner->id, ['created_at' => now()]);
        $this->owner->forceFill(['status' => 'suspended', 'restrictions' => ['suspension' => ['until' => null]]])->save();
        Sanctum::actingAs($fan);

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertNotFound();
        $this->deleteJson('/api/v1/users/lukas.sc/follow')->assertOk();

        expect($fan->following()->count())->toBe(0);

        $this->deleteJson('/api/v1/users/niemand/follow')->assertOk()->assertJsonPath('data.followers', null);
    });

    it('is limited to 200 a day', function () {
        config(['speedclub.rate_limits.follows.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertOk();
        $this->postJson('/api/v1/users/lukas.sc/follow')->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    });

    it('refuses a staff session', function () {
        $this->actingAs(Staff::factory()->create(), 'staff');

        $this->postJson('/api/v1/users/lukas.sc/follow')->assertUnauthorized();
    });
});
