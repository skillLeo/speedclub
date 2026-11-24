<?php

use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

/** R4B-006 (client round 4 hunt): a new mod names the part at least once; a bare category is refused. */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create();
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
    Sanctum::actingAs($this->owner);
});

it('refuses a new mod with nothing but its category, naming the title field', function (array $payload) {
    $this->withHeader('Accept-Language', 'de')->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'status' => 'installed', ...$payload])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['title' => 'Gib mindestens eine Angabe zum Teil ein']);

    expect(Modification::query()->count())->toBe(0);
})->with([
    'nothing' => [[]],
    'empty strings' => [['title' => ' ', 'part_number' => '', 'fields' => ['wheel_brand' => '', 'staggered' => false]]],
    'only private notes and a cost' => [['notes' => 'Teuer.', 'cost_cents' => 1000]],
]);

it('accepts a new mod as soon as one detail names the part', function (array $payload) {
    $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'status' => 'installed', ...$payload])->assertCreated();
})->with([
    'a title' => [['title' => 'Sommerräder']],
    'a brand in the fields' => [['fields' => ['wheel_brand' => 'BBS']]],
    'a size' => [['fields' => ['diameter' => 19]]],
    'a part number' => [['part_number' => 'LM-123']],
    'a free brand' => [['brand_text' => 'BBS']],
]);

it('lets a plan name only its category and month', function () {
    $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'status' => 'planned', 'target_month' => now()->addYear()->format('Y-m')])
        ->assertCreated();
});

it('answers somebody else 403 before it looks at the details', function () {
    Sanctum::actingAs(User::factory()->create());

    $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'status' => 'installed'])->assertForbidden();
});
