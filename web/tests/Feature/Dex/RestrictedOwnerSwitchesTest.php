<?php

use App\Enums\RestrictionType;
use App\Models\User;
use App\Models\Vehicle;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b part 2: a member under a publishing restriction may still take exposure away from their car — switch on Ghost mode, pause
 * spotting, hide the spot cities — through PATCH vehicles/{id}. Switching one off, or any other change, stays restricted (403
 * account_restricted). Everybody else's answers are those of the existing matrix.
 */
beforeEach(function () {
    $this->owner = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
    $this->car = publishedVehicle($this->owner);
});

it('lets a restricted owner switch on what hides the car', function (array $body) {
    Sanctum::actingAs($this->owner);

    $response = $this->patchJson("/api/v1/vehicles/{$this->car->id}", $body)->assertOk();

    foreach ($body as $key => $value) {
        expect($response->json("data.$key"))->toBe($value)
            ->and($this->car->refresh()->getAttribute($key))->toBe($value);
    }
})->with([
    'ghost mode' => [['ghost_mode' => true]],
    'spotting paused' => [['spotting_paused' => true]],
    'cities hidden' => [['hide_spot_cities' => true]],
    'all three' => [['ghost_mode' => true, 'spotting_paused' => true, 'hide_spot_cities' => true]],
    'one on, one unchanged off' => [['ghost_mode' => true, 'hide_spot_cities' => false]],
]);

it('keeps a restricted owner from showing the car again or changing anything else', function (array $body, array $before) {
    $this->car->forceFill($before)->save();
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/vehicles/{$this->car->id}", $body)->assertForbidden()->assertJsonPath('code', 'account_restricted');

    expect($this->car->refresh()->only(array_keys($before)))->toBe($before);
})->with([
    'ghost mode off' => [['ghost_mode' => false], ['ghost_mode' => true]],
    'spotting resumed' => [['spotting_paused' => false], ['spotting_paused' => true]],
    'cities shown' => [['hide_spot_cities' => false], ['hide_spot_cities' => true]],
    'a switch with another field' => [['ghost_mode' => true, 'nickname' => 'Neu'], ['ghost_mode' => false]],
    'another field only' => [['nickname' => 'Neu'], ['ghost_mode' => false]],
    'nothing' => [[], ['ghost_mode' => false]],
]);

it('leaves the other answers as they were: owner without restriction, other member, guest, blocked', function (Closure $who, int $status) {
    $viewer = $who($this->owner, $this->car);

    if ($viewer instanceof User) {
        Sanctum::actingAs($viewer);
    }

    $this->patchJson("/api/v1/vehicles/{$this->car->id}", ['ghost_mode' => true])->assertStatus($status);
})->with([
    'owner without restriction' => [function (User $owner, Vehicle $car): User {
        $free = dexMember();
        $car->forceFill(['owner_id' => $free->id])->save();

        return $free;
    }, 200],
    'other member' => [fn (): User => dexMember(), 403],
    'restricted other member' => [fn (): User => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), 403],
    'blocked member' => [function (User $owner): User {
        $blocked = dexMember();
        dexBlock($owner, $blocked);

        return $blocked;
    }, 403],
    'guest' => [fn () => null, 401],
]);

it('still validates the switches strictly', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/vehicles/{$this->car->id}", ['ghost_mode' => 'yes'])->assertUnprocessable()->assertJsonValidationErrorFor('ghost_mode');
});
