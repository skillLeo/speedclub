<?php

use App\Models\User;
use App\Models\VehicleHighlight;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 Highlights rail (09 §8.5): GET/PUT vehicles/{id}/highlights.
 */
beforeEach(function () {
    s2Flags();
    $this->owner = User::factory()->create();
    $this->vehicle = publishedVehicle($this->owner);
    $this->update = s2Post($this->vehicle);
    $this->photo = $this->vehicle->media()->firstOrFail();
});

it('pins updates and photos in order and shows them to guests', function () {
    Sanctum::actingAs($this->owner);

    $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/highlights", ['items' => [
        ['type' => 'photo', 'id' => $this->photo->id],
        ['type' => 'build_update', 'id' => $this->update->id],
    ]])->assertOk()->assertJsonPath('data.0.type', 'photo')->assertJsonPath('data.1.build_update.id', $this->update->id);

    app('auth')->forgetGuards();
    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/highlights")->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.photo.id', $this->photo->id);

    Sanctum::actingAs($this->owner);
    $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/highlights", ['items' => []])->assertOk()->assertJsonCount(0, 'data');
    expect(VehicleHighlight::query()->count())->toBe(0);
});

it('takes at most 8 items of this vehicle only, each once', function () {
    Sanctum::actingAs($this->owner);
    $foreign = s2Post(publishedVehicle());
    $url = "/api/v1/vehicles/{$this->vehicle->id}/highlights";

    $this->putJson($url, ['items' => array_fill(0, 9, ['type' => 'photo', 'id' => $this->photo->id])])->assertUnprocessable()->assertJsonValidationErrors('items');
    $this->putJson($url, ['items' => [['type' => 'build_update', 'id' => $foreign->id]]])->assertUnprocessable()->assertJsonValidationErrors('items.0.id');
    $this->putJson($url, ['items' => [['type' => 'photo', 'id' => $this->photo->id], ['type' => 'photo', 'id' => $this->photo->id]]])->assertUnprocessable();
    $this->putJson($url, ['items' => [['type' => 'story', 'id' => $this->photo->id]]])->assertUnprocessable();
});

it('hides a pinned followers-only update from non-followers', function () {
    $private = s2Post($this->vehicle, ['audience' => 'followers']);
    VehicleHighlight::factory()->create(['vehicle_id' => $this->vehicle->id, 'item_id' => $private->id]);

    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/highlights")->assertJsonCount(0, 'data');
    Sanctum::actingAs($this->owner);
    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/highlights")->assertJsonCount(1, 'data');
});

it('is the owner\'s to set', function (Closure $who, int $status) {
    socActAs($who($this->owner));

    $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/highlights", ['items' => []])->assertStatus($status);
})->with(ownerOnlyMatrix(200));

it('hides the rail of a vehicle the viewer may not see', function () {
    $other = User::factory()->create();
    socBlock($this->owner, $other);
    Sanctum::actingAs($other);

    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/highlights")->assertNotFound();
});
