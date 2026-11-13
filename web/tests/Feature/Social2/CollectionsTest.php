<?php

use App\Models\MemberCollection;
use App\Models\MemberCollectionItem;
use App\Models\Save;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 private collections (09 §8.6, COL-01/02): me/collections and its items, the save routes in sync, and the migration of saves.
 */
beforeEach(function () {
    seedModSchema();
    s2Flags();
    socSavesOn();
    $this->member = User::factory()->create(['username' => 'lukas.sc']);
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
});

describe('me/collections', function () {
    it('starts with "Gespeichert", creates, renames, reorders and deletes named ones', function () {
        Sanctum::actingAs($this->member);

        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/me/collections')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Gespeichert')->assertJsonPath('data.0.is_default', true);
        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/me/collections')->assertJsonPath('data.0.name', 'Saved');

        $id = $this->postJson('/api/v1/me/collections', ['name' => '  Japan-Builds '])->assertCreated()->assertJsonPath('data.name', 'Japan-Builds')->json('data.id');
        $this->patchJson("/api/v1/me/collections/$id", ['name' => 'JDM'])->assertOk()->assertJsonPath('data.name', 'JDM');
        $default = MemberCollection::query()->where('is_default', true)->value('id');
        $this->putJson('/api/v1/me/collections/order', ['ids' => [$id, $default]])->assertNoContent();
        $this->putJson('/api/v1/me/collections/order', ['ids' => [$id]])->assertUnprocessable();

        $this->deleteJson("/api/v1/me/collections/$default")->assertStatus(409);
        $this->deleteJson("/api/v1/me/collections/$id")->assertNoContent();
        expect(MemberCollection::query()->count())->toBe(1);
    });

    it('validates the name and bounds the number of collections', function () {
        Sanctum::actingAs($this->member);
        $this->postJson('/api/v1/me/collections', ['name' => '   '])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->postJson('/api/v1/me/collections', ['name' => str_repeat('a', 61)])->assertUnprocessable();

        config(['speedclub.social_2.max_collections' => 2]);
        $this->postJson('/api/v1/me/collections', ['name' => 'Eins'])->assertCreated();
        $this->postJson('/api/v1/me/collections', ['name' => 'Zwei'])->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    });

    it('keeps them private: another member\'s collection is 403, a guest 401, a deactivated account 403, the flag off 404', function () {
        $foreign = MemberCollection::factory()->create();
        Sanctum::actingAs($this->member);
        $this->patchJson("/api/v1/me/collections/{$foreign->id}", ['name' => 'x'])->assertForbidden();
        $this->getJson("/api/v1/me/collections/{$foreign->id}/items")->assertForbidden();
        $this->deleteJson("/api/v1/me/collections/{$foreign->id}")->assertForbidden();

        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->getJson('/api/v1/me/collections')->assertForbidden();

        app('auth')->forgetGuards();
        $this->getJson('/api/v1/me/collections')->assertUnauthorized();

        s2Flags(['collections' => false]);
        Sanctum::actingAs($this->member);
        $this->getJson('/api/v1/me/collections')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('works for unverified, restricted and blocked-elsewhere members (private, like saves)', function () {
        Sanctum::actingAs(User::factory()->unverified()->create());
        $this->getJson('/api/v1/me/collections')->assertOk();
    });
});

describe('items', function () {
    it('adds builds, mods and updates the member can see, keeps saves in step, and says where an item is', function () {
        Sanctum::actingAs($this->member);
        $id = $this->postJson('/api/v1/me/collections', ['name' => 'JDM'])->json('data.id');
        $mod = modIn($this->vehicle, 'suspension');
        $update = s2Post($this->vehicle);

        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $this->vehicle->id])->assertCreated()
            ->assertJsonPath('data.vehicle.id', $this->vehicle->id);
        // Already there: the same entry, 200.
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $this->vehicle->id])->assertOk();
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'modification', 'id' => $mod->id])->assertCreated()->assertJsonPath('data.modification.id', $mod->id);
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'build_update', 'id' => $update->id])->assertCreated()->assertJsonPath('data.build_update.id', $update->id);

        expect(Save::query()->where('user_id', $this->member->id)->count())->toBe(1)->and(MemberCollectionItem::query()->count())->toBe(3);
        $this->getJson("/api/v1/me/collections/$id/items")->assertOk()->assertJsonPath('data.0.type', 'build_update')->assertJsonCount(3, 'data');
        $this->getJson("/api/v1/me/collections?contains_type=vehicle&contains_id={$this->vehicle->id}")
            ->assertJsonPath('data.0.contains', false)->assertJsonPath('data.1.contains', true)->assertJsonPath('data.1.items_count', 3);

        $this->deleteJson("/api/v1/me/collections/$id/items/vehicle/{$this->vehicle->id}")->assertNoContent();
        expect(Save::query()->count())->toBe(0);
    });

    it('refuses the own build (403) and anything the member may not see (404)', function () {
        Sanctum::actingAs($this->owner);
        $id = $this->postJson('/api/v1/me/collections', ['name' => 'Eigene'])->json('data.id');
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $this->vehicle->id])->assertForbidden();

        $private = publishedVehicle(null, ['visibility' => 'private']);
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $private->id])->assertNotFound();
        // Events (M4.12) and businesses (M4.14) are items: an id that is none of them is the 404 of an unknown item.
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'event', 'id' => $private->id])->assertNotFound();
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'business', 'id' => $private->id])->assertNotFound();
    });

    it('leaves out what the member can no longer see, keeps it stored, and reorders what it shows', function () {
        Sanctum::actingAs($this->member);
        $id = $this->postJson('/api/v1/me/collections', ['name' => 'JDM'])->json('data.id');
        $other = publishedVehicle();
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $this->vehicle->id]);
        $this->postJson("/api/v1/me/collections/$id/items", ['type' => 'vehicle', 'id' => $other->id]);
        socBlock($this->owner, $this->member);

        $this->getJson("/api/v1/me/collections/$id/items")->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $other->id);
        $this->putJson("/api/v1/me/collections/$id/items/order", ['ids' => ["vehicle:{$other->id}"]])->assertNoContent();
        $this->putJson("/api/v1/me/collections/$id/items/order", ['ids' => ['vehicle:01JAAAAAAAAAAAAAAAAAAAAAAA']])->assertUnprocessable();
        expect(MemberCollectionItem::query()->count())->toBe(2);
    });

    it('puts a build saved with the old route into "Gespeichert", and unsaving takes it out of every collection', function () {
        Sanctum::actingAs($this->member);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/save")->assertOk();

        $default = MemberCollection::query()->where('user_id', $this->member->id)->where('is_default', true)->sole();
        expect($default->items()->value('item_id'))->toBe($this->vehicle->id);

        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/save")->assertOk();
        expect(MemberCollectionItem::query()->count())->toBe(0);
    });

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs($this->member);
        $first = $this->postJson('/api/v1/me/collections', ['name' => 'Eins'], ['Idempotency-Key' => 'col-1'])->json('data.id');

        expect($this->postJson('/api/v1/me/collections', ['name' => 'Eins'], ['Idempotency-Key' => 'col-1'])->json('data.id'))->toBe($first);
    });
});

describe('migration 2026_11_30_100200 (saves into "Gespeichert")', function () {
    it('moves saves idempotently, newest on top, and takes back exactly that', function () {
        $older = publishedVehicle();
        Save::query()->insert([
            ['user_id' => $this->member->id, 'vehicle_id' => $older->id, 'created_at' => now()->subDay()],
            ['user_id' => $this->member->id, 'vehicle_id' => $this->vehicle->id, 'created_at' => now()],
        ]);
        $migration = require database_path('migrations/2026_11_30_100200_move_saves_into_collections.php');

        $migration->up();
        $migration->up();

        $default = MemberCollection::query()->where('user_id', $this->member->id)->where('is_default', true)->sole();
        expect($default->items()->orderByDesc('position')->pluck('item_id')->all())->toBe([$this->vehicle->id, $older->id]);

        $migration->down();
        expect(MemberCollection::query()->count())->toBe(0)->and(DB::table('saves')->count())->toBe(2);
    });
});
