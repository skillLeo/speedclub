<?php

use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;

require_once __DIR__.'/../M32/Helpers.php';
require_once __DIR__.'/../../Discover/DiscoverM23Helpers.php';

/**
 * M3.3 catalogue admin HTTP tests (lane b). Functions are prefixed adm33 so they never collide with the lane-a helpers (m33c…).
 * catalog.view / .manage / .import are held by Owner, Admin and Content editor only (06 §2); moderator, support and analyst hear 403.
 */
const ADM33_CATALOG = ['owner', 'admin', 'content_editor'];

/**
 * A make with one model and one generation, and $vehicles vehicles on them.
 *
 * @return array{0: Make, 1: VehicleModel, 2: Generation}
 */
function adm33Tree(string $make = 'Wiesmann', string $model = 'MF5', string $generation = 'Roadster', int $vehicles = 0): array
{
    $m = Make::factory()->create(['name' => $make, 'slug' => str($make)->slug()->value()]);
    $vm = VehicleModel::factory()->create(['make_id' => $m->id, 'name' => $model, 'slug' => str($model)->slug()->value()]);
    $g = Generation::factory()->create(['model_id' => $vm->id, 'name' => $generation, 'slug' => str($generation)->slug()->value(), 'year_from' => 2009, 'year_to' => 2014]);

    if ($vehicles > 0) {
        $owner = User::factory()->create();
        Vehicle::factory()->count($vehicles)->create(['owner_id' => $owner->id, 'make_id' => $m->id, 'model_id' => $vm->id, 'generation_id' => $g->id]);
    }

    return [$m, $vm, $g];
}

/** A member's open request with a free-text vehicle. */
function adm33Request(string $make = 'Donkervoort', ?string $model = 'D8 GTO', string $username = 'paul.adm33'): CatalogRequest
{
    $member = User::factory()->create(['username' => $username]);
    $vehicle = Vehicle::factory()->create(['owner_id' => $member->id, 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => $make, 'model_text' => $model]);
    $request = new CatalogRequest(['vehicle_id' => $vehicle->id, 'make_text' => $make, 'model_text' => $model]);
    $request->forceFill(['user_id' => $member->id])->save();

    return $request->refresh();
}
