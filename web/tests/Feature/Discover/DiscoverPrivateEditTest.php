<?php

use App\Enums\ModStatus;
use App\Models\BuildUpdate;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\RebuildVehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * SEC-M18-03: an edit of a modification that nobody but the owner can read (its notes, a cost that is not public) must not move
 * the build in "Neue Builds" nor change its public updated_at. That would tell others when the owner was active in private data,
 * and would let an owner keep a build at the top with edits nobody sees. An edit others can read still moves it.
 */
beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create();
    $this->old = publishedVehicle($this->owner);
    $this->mod = modIn($this->old, 'wheels_tires', ['diameter' => 19, 'width_front' => 9.5], [
        'title' => 'BBS LM', 'status' => ModStatus::Installed, 'cost_public' => false, 'cost_cents' => 100_000, 'notes' => 'alt',
    ]);
    Vehicle::query()->whereKey($this->old->id)->update(['updated_at' => now()->subDays(3)]);
    app(VehicleSearchProjector::class)->rebuild($this->old->id);

    $this->new = publishedVehicle(User::factory()->create());
    Vehicle::query()->whereKey($this->new->id)->update(['updated_at' => now()->subDay()]);
    app(VehicleSearchProjector::class)->rebuild($this->new->id);

    $this->card = fn (): array => collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->firstWhere('id', $this->old->id);
    $this->before = ($this->card)()['updated_at'];
});

/**
 * PATCH as the owner, then what a worker would do with whatever it queued.
 *
 * @param  array<string, mixed>  $body
 */
function privateEditPatch(Modification $mod, User $owner, array $body): void
{
    Sanctum::actingAs($owner);
    test()->patchJson("/api/v1/mods/{$mod->id}", $body)->assertOk();
    app('auth')->forgetGuards();
    app(VehicleSearchProjector::class)->rebuild($mod->vehicle_id);
}

it('keeps a build where it was after an edit nobody else can read', function (array $body) {
    Queue::fake();

    privateEditPatch($this->mod, $this->owner, $body);

    $cards = $this->getJson('/api/v1/home/new-builds')->assertOk()->json('data');

    expect($cards[0]['id'])->toBe($this->new->id)
        ->and(($this->card)()['updated_at'])->toBe($this->before)
        ->and(Vehicle::query()->findOrFail($this->old->id)->updated_at?->isToday())->toBeFalse()
        ->and(BuildUpdate::query()->where('vehicle_id', $this->old->id)->count())->toBe(0);
    Queue::assertNotPushed(RebuildVehicleSearch::class);

    // The owner's own copy did change.
    expect($this->mod->refresh()->getAttribute('notes'))->toBe($body['notes'] ?? 'alt');
})->with([
    'notes and a private cost' => [['notes' => 'nur für mich', 'cost_cents' => 4200]],
    'notes alone' => [['notes' => 'nur für mich']],
    'a private cost alone' => [['cost_cents' => 4200]],
    // M4.9 ruling: costs are never public, so an older app's cost_public changes nothing others read.
    'the cost made public (ignored)' => [['cost_public' => true]],
    'a cost with cost_public (ignored)' => [['cost_public' => true, 'cost_cents' => 4200]],
    'the whole form again, fields in another order, new notes' => [[
        'title' => 'BBS LM', 'status' => 'installed', 'fields' => ['width_front' => 9.5, 'diameter' => 19],
        'cost_public' => false, 'cost_cents' => 100_000, 'notes' => 'neu',
    ]],
]);

it('moves the build to the top after an edit others can read', function (array $body) {
    privateEditPatch($this->mod, $this->owner, $body);

    $cards = $this->getJson('/api/v1/home/new-builds')->assertOk()->json('data');

    expect($cards[0]['id'])->toBe($this->old->id)
        ->and($cards[0]['updated_at'])->not->toBe($this->before);
})->with([
    'the title' => [['title' => 'BBS LM Gold']],
    'a field' => [['fields' => ['diameter' => 20, 'width_front' => 9.5]]],
    'the status' => [['status' => 'removed']],
    'the part number' => [['part_number' => 'LM-123']],
]);
