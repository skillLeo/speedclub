<?php

use App\Enums\MaintenanceType;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use App\Services\Showcase\Showcase;
use App\Services\Showcase\ShowcaseMaintenance;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/MaintenanceTestHelpers.php';

/**
 * M4.13 SET-11 units and SET-23 reminder defaults (09 §8.11, §7.9), the Art. 20 export (maintenance.json) and the sample rule (09 §8.19).
 */
beforeEach(function () {
    mntFlags();
    $this->owner = User::factory()->create(['username' => 'finn.jdm']);
});

it('reads and changes the units and the SET-23 defaults, storing only what changed', function () {
    Sanctum::actingAs($this->owner);

    $this->getJson('/api/v1/me/settings')->assertOk()
        ->assertJsonPath('data.distance_unit', 'km')
        ->assertJsonPath('data.torque_unit', 'nm')
        ->assertJsonPath('data.weight_unit', 'kg')
        ->assertJsonPath('data.maintenance', ['hu_au_lead_days' => [30, 14, 1], 'tyre_reminders' => true, 'insurance_reminder' => true, 'service_reminders' => true]);

    $this->patchJson('/api/v1/me/settings', ['distance_unit' => 'mi', 'torque_unit' => 'lbft', 'weight_unit' => 'lb', 'maintenance' => ['hu_au_lead_days' => [7, 28], 'tyre_reminders' => false]])->assertOk()
        ->assertJsonPath('data.distance_unit', 'mi')
        ->assertJsonPath('data.torque_unit', 'lbft')
        ->assertJsonPath('data.weight_unit', 'lb')
        ->assertJsonPath('data.maintenance.hu_au_lead_days', [28, 7])
        ->assertJsonPath('data.maintenance.tyre_reminders', false)
        ->assertJsonPath('data.maintenance.service_reminders', true);

    expect($this->owner->fresh()?->getAttribute('maintenance_prefs'))->toEqual(['hu_au_lead_days' => [28, 7], 'tyre_reminders' => false]);
});

it('validates units and SET-23', function (array $body, string $field) {
    Sanctum::actingAs($this->owner);
    $this->patchJson('/api/v1/me/settings', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'distance' => [['distance_unit' => 'yards'], 'distance_unit'],
    'torque' => [['torque_unit' => 'kgm'], 'torque_unit'],
    'weight' => [['weight_unit' => 'stone'], 'weight_unit'],
    'unknown key' => [['maintenance' => ['oil_reminders' => true]], 'maintenance'],
    'too many leads' => [['maintenance' => ['hu_au_lead_days' => [60, 30, 14, 1]]], 'maintenance.hu_au_lead_days'],
    'lead out of range' => [['maintenance' => ['hu_au_lead_days' => [120]]], 'maintenance.hu_au_lead_days.0'],
    'no leads' => [['maintenance' => ['hu_au_lead_days' => []]], 'maintenance.hu_au_lead_days'],
    'not a bool' => [['maintenance' => ['tyre_reminders' => 'yes']], 'maintenance.tyre_reminders'],
]);

it('exports the member\'s maintenance with costs and the reminders sent, and nobody else\'s', function () {
    $vehicle = publishedVehicle($this->owner);
    $vehicle->forceFill(['odometer_km' => 48200])->save();
    $item = mntItem($vehicle, MaintenanceType::OilChange);
    mntLog($vehicle, ['item_id' => $item->id, 'cost_cents' => 18900, 'workshop' => 'Werkstatt am Ring']);
    mntLog(publishedVehicle(), ['cost_cents' => 77700]);

    $export = app(ExportContents::class)->documents($this->owner)['maintenance.json'];
    $json = (string) json_encode($export);

    expect($export['vehicles'])->toHaveCount(1)
        ->and($export['vehicles'][0]['vehicle'])->toBe($vehicle->public_id)
        ->and($export['vehicles'][0]['odometer_km'])->toBe(48200)
        ->and($export['vehicles'][0]['items'][0]['type'])->toBe('oil_change')
        ->and($export['vehicles'][0]['logs'][0]['cost_cents'])->toBe(18900)
        ->and($json)->not->toContain('77700');
});

it('seeds sample maintenance only the sample owner reads, whatever editorial_samples says', function () {
    app()->detectEnvironment(fn () => 'staging');
    $owner = User::factory()->create(['username' => Showcase::SHOWCASE_USERNAME, 'is_sample' => true]);
    $vehicle = publishedVehicle($owner, ['is_sample' => true]);

    expect(app(ShowcaseMaintenance::class)->seed())->toBe(5)
        ->and(app(ShowcaseMaintenance::class)->seed())->toBe(5)
        ->and($vehicle->maintenanceItems()->count())->toBe(5)
        ->and($vehicle->maintenanceLogs()->count())->toBe(3);

    mntFlags(['editorial_samples' => false]);
    Sanctum::actingAs($owner);
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/maintenance-items")->assertOk()->assertJsonCount(5, 'data');
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/costs")->assertOk()->assertJsonPath('data.maintenance_cents', 32350);
    // No reminders for sample builds, so the plan stays empty.
    $this->getJson('/api/v1/me/maintenance/reminders')->assertOk()->assertJsonCount(0, 'data.stages');

    Sanctum::actingAs(User::factory()->create());
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/maintenance-items")->assertForbidden();
    $this->getJson("/api/v1/vehicles/{$vehicle->id}/costs")->assertForbidden();
});
