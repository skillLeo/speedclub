<?php

use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * The shape the mobile client is typed against: keys and value types, stored in tests/.pest/snapshots. A change here is a change of
 * the API, to be made on purpose together with the OpenAPI export.
 */
beforeEach(function () {
    Storage::fake('public');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'city' => 'Stuttgart']);
    $this->vehicle = publishedVehicle($this->owner, ['color' => 'Blau', 'description' => 'Text', 'nickname' => 'Name', 'model_year' => 2002, 'generation_id' => null]);

    $specs = new VehicleSpec(['vehicle_id' => $this->vehicle->id, 'engine_text' => 'R6', 'engine_code' => 'RB26', 'displacement_cc' => 2568, 'torque_nm' => 540, 'torque_source' => 'measured', 'drivetrain' => 'all', 'gearbox' => 'manual', 'fuel' => 'petrol', 'aspiration' => 'biturbo']);
    $specs->setPower(500, PowerUnit::Ps, PowerSource::Measured)->save();

    app(QrCodes::class)->ensureActive($this->vehicle);

    $this->mod = modIn($this->vehicle, 'suspension', ['type' => 'coilover', 'lowering_front' => 35], ['title' => 'KW V3', 'cost_cents' => 100, 'cost_public' => true, 'installed_on' => '2022-03-01', 'notes' => 'Text']);
    Media::factory()->forModel($this->mod)->create(['owner_id' => $this->owner->id]);

    $this->update = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'payload' => ['changes' => [[
        'kind' => 'mod_changed', 'category' => 'suspension', 'modification_id' => $this->mod->id,
        'before' => ['title' => 'KW V3', 'status' => 'installed', 'fields' => ['lowering_front' => 30]],
        'after' => ['title' => 'KW V3', 'status' => 'installed', 'fields' => ['lowering_front' => 35]],
    ]]]]);
});

it('keeps the shape of the owner\'s vehicle', function () {
    Sanctum::actingAs($this->owner);

    expect(jsonShape($this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->json()))->toMatchSnapshot();
});

it('keeps the shape of a garage card', function () {
    Sanctum::actingAs($this->owner);

    expect(jsonShape($this->getJson('/api/v1/me/vehicles')->assertOk()->json('data.0')))->toMatchSnapshot();
});

it('keeps the shape of the public vehicle page', function () {
    expect(jsonShape($this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk()->json()))->toMatchSnapshot();
});

it('keeps the shape of a modification, for the owner and for the public', function () {
    Sanctum::actingAs($this->owner);

    expect(jsonShape($this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->json()))->toMatchSnapshot();

    app('auth')->forgetGuards();

    expect(jsonShape($this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug()."/mods/{$this->mod->id}")->assertOk()->json()))->toMatchSnapshot();
});

it('keeps the shape of a build update', function () {
    expect(jsonShape($this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug()."/updates/{$this->update->id}")->assertOk()->json()))->toMatchSnapshot();
});

it('keeps the shape of a member profile', function () {
    expect(jsonShape($this->getJson('/api/v1/public/users/lukas.sc')->assertOk()->json()))->toMatchSnapshot();
});

it('writes the error of a page nobody may see as the documented body', function () {
    $body = $this->getJson('/api/v1/public/vehicles/nichts-ZZZZZZZZ')->assertNotFound()->json();

    expect(array_keys($body))->toBe(['message', 'code', 'errors']);
});
