<?php

use App\Models\Generation;
use App\Models\Make;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Support\Str;

/**
 * DQ-293: the short car line under an avatar, model and generation without make or engine.
 */
it('shortens to model and generation', function (string $make, string $model, ?string $generation, ?string $expected) {
    $makeRow = Make::factory()->create(['name' => $make, 'slug' => Str::slug($make)]);
    $modelRow = VehicleModel::factory()->create(['make_id' => $makeRow->id, 'name' => $model, 'slug' => Str::slug($model)]);
    $generationRow = $generation === null ? null : Generation::factory()->create(['model_id' => $modelRow->id, 'name' => $generation]);
    $vehicle = Vehicle::factory()->create(['make_id' => $makeRow->id, 'model_id' => $modelRow->id, 'generation_id' => $generationRow?->id])->fresh(['make', 'vehicleModel', 'generation']);

    expect(app(VehiclePresenter::class)->shortTitle($vehicle))->toBe($expected);
})->with([
    'Skyline' => ['Nissan', 'Skyline GT-R', 'R34', 'Skyline R34'],
    'Impreza' => ['Subaru', 'Impreza WRX STI', 'GD', 'Impreza GD'],
    'M4' => ['BMW', 'M4', 'G82', 'M4 G82'],
    'Golf GTI' => ['Volkswagen', 'Golf GTI', 'VII (5G)', 'Golf GTI VII'],
    'no generation' => ['Porsche', '911', null, '911'],
]);
