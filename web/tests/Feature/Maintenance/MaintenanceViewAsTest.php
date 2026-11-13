<?php

use App\Actions\Admin\Members\StartViewAs;
use App\Enums\MaintenanceType;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/MaintenanceTestHelpers.php';
require_once __DIR__.'/../Admin/Actions/Helpers.php';

/**
 * ADR-441 ruling: staff in view-as never see a member's maintenance, service log, odometer or private costs (like messages); a write is
 * read-only as before.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    mntFlags();
    seedModSchema();
    $this->member = User::factory()->create(['username' => 'kai.sti']);
    $this->vehicle = publishedVehicle($this->member);
    $this->item = mntItem($this->vehicle, MaintenanceType::OilChange);
    $this->log = mntLog($this->vehicle, ['item_id' => $this->item->id, 'cost_cents' => 18900]);
    $this->token = app(StartViewAs::class)->handle(m31Staff('admin'), $this->member, m32Reason(), false)['token'];
});

it('answers every maintenance read with view_as_private', function (string $uri) {
    $uri = str_replace(['{v}', '{log}'], [$this->vehicle->id, $this->log->id], $uri);

    $this->withToken($this->token)->getJson($uri)->assertForbidden()->assertJsonPath('code', 'view_as_private');
})->with([
    '/api/v1/vehicles/{v}/maintenance-items',
    '/api/v1/vehicles/{v}/maintenance-logs',
    '/api/v1/vehicles/{v}/maintenance-logs/{log}',
    '/api/v1/vehicles/{v}/costs',
    '/api/v1/me/maintenance/upcoming',
    '/api/v1/me/maintenance/reminders',
]);

it('keeps writes read-only and hides private mod costs, while the member still sees them', function () {
    $mod = modIn($this->vehicle, 'wheels_tires', [], ['cost_cents' => 250000, 'cost_public' => false]);

    $this->withToken($this->token)->putJson("/api/v1/vehicles/{$this->vehicle->id}/odometer", ['km' => 1])->assertForbidden()->assertJsonPath('code', 'view_as_read_only');
    $staffView = collect($this->withToken($this->token)->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()->json('data'))->firstWhere('id', $mod->id);
    expect($staffView['cost'])->toBeNull();

    $this->flushHeaders();
    $this->app['auth']->forgetGuards();
    Sanctum::actingAs($this->member);
    $own = collect($this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()->json('data'))->firstWhere('id', $mod->id);
    expect($own['cost']['cents'])->toBe(250000);
    $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/costs")->assertOk();
});
