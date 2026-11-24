<?php

use App\Enums\BuildScoreRankScope;
use App\Enums\LegalStatus;
use App\Enums\RestrictionType;
use App\Models\BuildScore;
use App\Models\BuildScoreHistory;
use App\Models\BuildScoreRank;
use App\Models\Generation;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpotStat;
use App\Services\BuildScore\BuildScores;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BuildScoreTestHelpers.php';

/**
 * M5.9c (m5.9c contract §4): GET vehicles/{id}/build-score, GET build-score/formula, `build_score` on the vehicle resources and
 * `is_registered` on mods; plus the lead's STREET DEX follow-ups: the public `dex_number`, typed spot stats and the PATCH vehicle body.
 */
beforeEach(function () {
    bsFlags();
    $this->owner = User::factory()->create();
    $this->car = bsCar($this->owner);
});

describe('GET build-score/formula', function () {
    it('answers the configured formula to guests', function () {
        $data = $this->getJson('/api/v1/build-score/formula')->assertOk()->assertHeader('ETag')->json('data');

        expect($data['max'])->toBe(1000)
            ->and($data['formula_version'])->toBe('1')
            ->and($data['stages'])->toBe([
                ['stage' => 1, 'min' => 0], ['stage' => 2, 'min' => 200], ['stage' => 3, 'min' => 400], ['stage' => 4, 'min' => 600], ['stage' => 5, 'min' => 800],
            ])
            ->and(array_column($data['parts'], 'key'))->toBe(['completeness', 'documentation', 'community', 'journey'])
            ->and(array_column($data['parts'], 'max'))->toBe([300, 300, 250, 150])
            ->and(collect($data['parts'])->flatMap(fn (array $part) => array_column($part['items'], 'key'))->all())->toBe([
                'photos', 'key_specs', 'description', 'cover_focal', 'documented_mods', 'registered_mods', 'reactors', 'spotters', 'followers',
                'timeline', 'before_after', 'history_span',
            ])
            ->and($data['parts'][0]['items'][0])->toBe(['key' => 'photos', 'points' => 20, 'limit' => 6, 'max' => 120])
            ->and($data['parts'][0]['items'][2])->toBe(['key' => 'description', 'points' => 50, 'limit' => null, 'max' => 50, 'min_chars' => 200]);
    });
});

describe('GET vehicles/{id}/build-score', function () {
    it('computes the score on the first read and answers the contract shape', function () {
        bsMod($this->car);
        expect(BuildScore::query()->find($this->car->id))->toBeNull();

        $data = $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data');

        // A visitor: no parts and no previous_total (the community part is mostly 2 points per reacting member, so one step would
        // show a single new reaction; reaction counts are private, review N-4).
        expect(array_keys($data))->toBe(['total', 'stage', 'ranks', 'computed_at', 'formula_version'])
            ->and(BuildScore::query()->find($this->car->id)?->total)->toBe($data['total']);

        Sanctum::actingAs($this->owner);
        $own = $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data');

        expect(array_keys($own))->toBe(['total', 'stage', 'parts', 'ranks', 'computed_at', 'previous_total', 'next_upgrades', 'formula_version'])
            ->and($own['parts']['documentation'])->toBe(['points' => 25, 'max' => 300])
            ->and(array_keys($own['parts']))->toBe(['completeness', 'documentation', 'community', 'journey'])
            ->and($own['total'])->toBe(array_sum(array_column($own['parts'], 'points')))
            ->and($own['total'])->toBe($data['total'])
            ->and($own['previous_total'])->toBeNull();

        // After a change the owner reads the step; a visitor (another member, a guest) still does not.
        bsMod($this->car);
        app(BuildScores::class)->recompute($this->car->id);
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data.previous_total'))->toBe($own['total']);

        Sanctum::actingAs(User::factory()->create());
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data'))->not->toHaveKey('previous_total');
        app('auth')->forgetGuards();
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data'))->not->toHaveKey('previous_total');
    });

    it('answers per viewer: parts and next_upgrades for the owner only, 404 where the car may not be seen', function (Closure $viewer, int $status, bool $upgrades) {
        $member = $viewer($this->owner, $this->car);

        if ($member instanceof User) {
            Sanctum::actingAs($member);
        } elseif ($member instanceof Staff) {
            $this->actingAs($member, 'staff');
        }

        $response = $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertStatus($status);

        if ($status === 404) {
            $response->assertJsonPath('code', 'vehicle_unavailable');

            return;
        }

        expect(array_key_exists('next_upgrades', $response->json('data')))->toBe($upgrades)
            // The parts go with the upgrades: owner only.
            ->and(array_key_exists('parts', $response->json('data')))->toBe($upgrades);
    })->with([
        'guest' => [fn () => null, 200, false],
        'owner' => [fn (User $owner) => $owner, 200, true],
        'other member' => [fn () => User::factory()->create(), 200, false],
        'restricted owner' => [function (User $owner) {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

            return $owner->refresh();
        }, 200, true],
        'restricted member' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), 200, false],
        'member the owner blocked' => [function (User $owner) {
            $member = User::factory()->create();
            bsBlock($owner, $member);

            return $member;
        }, 404, false],
        'member who blocked the owner' => [function (User $owner) {
            $member = User::factory()->create();
            bsBlock($member, $owner);

            return $member;
        }, 404, false],
        'staff session (counts as a guest)' => [fn () => Staff::factory()->create(), 200, false],
    ]);

    it('hides a private car from everybody but its owner, and answers 404 for an unknown id', function () {
        $this->car->forceFill(['visibility' => 'private'])->save();

        $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertNotFound();
        Sanctum::actingAs($this->owner);
        $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->assertJsonPath('data.ranks', []);
        $this->getJson('/api/v1/vehicles/01jzzzzzzzzzzzzzzzzzzzzzzz/build-score')->assertNotFound();
    });

    it('lists the owner\'s next upgrades with the app\'s keys, most points first', function () {
        bsMod($this->car, ['brand_text' => null]);
        Sanctum::actingAs($this->owner);

        $upgrades = $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data.next_upgrades');

        expect(array_column($upgrades, 'key'))->toContain('photos', 'description', 'cover_focal', 'documented_mods', 'timeline', 'before_after')
            ->and(array_diff(array_column($upgrades, 'key'), ['photos', 'key_specs', 'description', 'cover_focal', 'documented_mods', 'planned_mods', 'registered_mods', 'timeline', 'before_after']))->toBe([])
            ->and(collect($upgrades)->firstWhere('key', 'photos'))->toBe(['key' => 'photos', 'label_key' => 'photos', 'points' => 120, 'progress' => ['have' => 0, 'need' => 6]])
            ->and(array_column($upgrades, 'points'))->toBe(collect($upgrades)->pluck('points')->sortDesc()->values()->all());
    });

    it('shows the rank lines of groups of at least three, generation first, while the car may be ranked', function () {
        $this->owner->forceFill(['bundesland' => 'NW'])->save();
        $peers = collect(range(0, 3))->map(fn (int $i): Vehicle => bsCar(User::factory()->create(['bundesland' => $i < 2 ? 'NW' : 'BY']), ['generation_id' => $this->car->generation_id]));

        foreach ([$this->car, ...$peers] as $i => $car) {
            BuildScore::factory()->for($car)->total(500 - $i * 10)->create();
        }

        // The night's order: in the generation three peers before the car and one after it; in NRW one peer before and one after.
        foreach ([[$peers[0], 1], [$peers[1], 2], [$peers[2], 3], [$this->car, 4], [$peers[3], 5]] as [$car, $rank]) {
            BuildScoreRank::factory()->for($car)->create(['scope' => BuildScoreRankScope::Generation, 'scope_key' => (string) $this->car->generation_id, 'rank' => $rank, 'group_size' => 61]);
        }

        foreach ([[$peers[0], 1], [$this->car, 2], [$peers[1], 3]] as [$car, $rank]) {
            BuildScoreRank::factory()->for($car)->create(['scope' => BuildScoreRankScope::Bundesland, 'scope_key' => 'NW', 'rank' => $rank, 'group_size' => 14]);
        }

        $ranks = $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score", ['Accept-Language' => 'de'])->assertOk()->json('data.ranks');

        // The stored group sizes (61, 14) are stale: the API counts the group as it is now.
        expect($ranks)->toBe([
            ['scope' => 'generation', 'label' => $this->car->generation->name, 'rank' => 4, 'group_size' => 5, 'region' => 'Deutschland'],
            ['scope' => 'bundesland', 'label' => 'NRW', 'rank' => 2, 'group_size' => 3, 'region' => null],
        ]);
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score", ['Accept-Language' => 'en'])->json('data.ranks.0.region'))->toBe('Germany');

        // A peer in NRW goes private: the Bundesland group is down to two, under the minimum, so its line goes.
        $peers[1]->forceFill(['visibility' => 'private'])->save();
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->json('data.ranks'))->toBe([
            ['scope' => 'generation', 'label' => $this->car->generation->name, 'rank' => 3, 'group_size' => 4, 'region' => 'Germany'],
        ]);

        // A ghost car shows no rank (it is in no list either).
        $this->car->forceFill(['ghost_mode' => true])->save();
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->json('data.ranks'))->toBe([]);
    });

    it('counts the rank group at read, so cars that left since the night never inflate "#k von N" (R4DQ-09)', function () {
        $generation = (string) $this->car->generation_id;
        $peers = collect(range(0, 4))->map(fn (): Vehicle => bsCar(null, ['generation_id' => $this->car->generation_id]));
        $order = [$peers[0], $peers[1], $peers[2], $this->car, $peers[3], $peers[4]];

        foreach ($order as $i => $car) {
            BuildScore::factory()->for($car)->total(600 - $i * 10)->create();
            BuildScoreRank::factory()->for($car)->create(['scope' => BuildScoreRankScope::Generation, 'scope_key' => $generation, 'rank' => $i + 1, 'group_size' => 25]);
        }

        $line = fn (): ?array => $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->json('data.ranks.0');

        expect($line())->toMatchArray(['rank' => 4, 'group_size' => 6]);

        // Since the night: one car above is deleted, one above is unpublished, the owner of one below deleted their account.
        $peers[0]->delete();
        $peers[1]->forceFill(['status' => 'draft'])->save();
        $peers[3]->owner->delete();

        expect($line())->toMatchArray(['rank' => 2, 'group_size' => 3]);

        // Under three cars there is no rank line at all.
        $peers[4]->forceFill(['ghost_mode' => true])->save();
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->json('data.ranks'))->toBe([]);

        // A car published today counts in the group at once, but it ranks only from the next night on (no row yet).
        BuildScore::factory()->for(bsCar(null, ['generation_id' => $this->car->generation_id]))->total(999)->create();
        expect($line())->toMatchArray(['rank' => 2, 'group_size' => 3]);

        // A car that moved to another generation since the night shows no stale line.
        $this->car->forceFill(['generation_id' => Generation::factory()->create(['model_id' => $this->car->model_id])->id])->save();
        expect($this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->json('data.ranks'))->toBe([]);
    });

    it('answers {data: null} when the score cannot be computed', function () {
        $this->mock(BuildScores::class, fn ($mock) => $mock->shouldReceive('read')->andReturn(null));

        $this->getJson("/api/v1/vehicles/{$this->car->id}/build-score")->assertOk()->assertExactJson(['data' => null]);
    });
});

describe('resources', function () {
    it('carries build_score {total, stage} on the garage card, the owner\'s vehicle and the public page; null before the first score', function () {
        Sanctum::actingAs($this->owner);
        expect($this->getJson('/api/v1/me/vehicles')->assertOk()->json('data.0.build_score'))->toBeNull();

        BuildScore::factory()->for($this->car)->total(642)->create();

        expect($this->getJson('/api/v1/me/vehicles')->json('data.0.build_score'))->toBe(['total' => 642, 'stage' => 4])
            ->and($this->getJson("/api/v1/vehicles/{$this->car->id}")->json('data.build_score'))->toBe(['total' => 642, 'stage' => 4])
            ->and($this->getJson("/api/v1/public/vehicles/{$this->car->slug}")->json('data.build_score'))->toBe(['total' => 642, 'stage' => 4]);
    });

    it('marks a mod the owner states as entered in the papers as is_registered', function (LegalStatus $status, bool $registered) {
        seedModSchema();
        $mod = bsMod($this->car, ['legal_status' => $status]);
        Sanctum::actingAs($this->owner);

        expect($this->getJson("/api/v1/mods/{$mod->id}")->assertOk()->json('data.is_registered'))->toBe($registered);
    })->with([
        'registered' => [LegalStatus::Registered, true],
        'individual approval' => [LegalStatus::IndividualApproval, true],
        'ABE' => [LegalStatus::Abe, false],
        'unknown' => [LegalStatus::Unknown, false],
    ]);

    it('says false for is_registered while the legal status flag is off', function () {
        bsFlags(['sig.mod_legal_status' => false]);
        seedModSchema();
        $mod = bsMod($this->car, ['legal_status' => LegalStatus::Registered]);
        Sanctum::actingAs($this->owner);

        expect($this->getJson("/api/v1/mods/{$mod->id}")->assertOk()->json('data.is_registered'))->toBeFalse();
    });

    it('shows the Dex number on the public vehicle page to everybody (lead follow-up)', function () {
        $this->car->forceFill(['dex_number' => 87])->save();

        $this->getJson("/api/v1/public/vehicles/{$this->car->slug}")->assertOk()->assertJsonPath('data.dex_number', 87);
        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/public/vehicles/{$this->car->slug}")->assertOk()->assertJsonPath('data.dex_number', 87);
    });

    it('sends the owner\'s spot numbers as integers (lead follow-up)', function () {
        VehicleSpotStat::factory()->create(['vehicle_id' => $this->car->id, 'total' => 5, 'unique_spotters' => 3]);
        Sanctum::actingAs($this->owner);

        $data = $this->getJson("/api/v1/vehicles/{$this->car->id}/spot-stats")->assertOk()->json('data');

        expect($data['total'])->toBeInt()->and($data['unique_spotters'])->toBeInt()->and($data['cities_count'])->toBeInt();
    });
});

it('documents the score routes, the new fields, the PATCH vehicle switches and typed spot stats in the OpenAPI export', function () {
    $path = tempnam(sys_get_temp_dir(), 'openapi');
    $this->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    /** @var array<string, mixed> $document */
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    $schemas = $document['components']['schemas'];
    $types = fn (string $schema) => array_map(fn (array $property) => $property['type'] ?? $property['anyOf'] ?? $property['$ref'] ?? null, $schemas[$schema]['properties']);
    $patch = $document['paths']['/vehicles/{vehicle}']['patch']['requestBody']['content']['application/json']['schema']['$ref'];

    expect($document['paths'])->toHaveKeys(['/build-score/formula', '/vehicles/{vehicle}/build-score'])
        ->and($document['paths']['/vehicles/{vehicle}/build-score']['get']['security'])->toBe([])
        ->and($types('BuildScoreResource'))->toMatchArray(['total' => 'integer', 'stage' => 'integer', 'ranks' => 'array', 'previous_total' => ['integer', 'null'], 'formula_version' => 'string'])
        ->and($types('BuildScoreFormulaResource'))->toMatchArray(['max' => 'integer', 'stages' => 'array', 'parts' => 'array'])
        ->and($schemas['VehicleCardResource']['properties']['build_score']['properties'])->toHaveKeys(['total', 'stage'])
        ->and($types('PublicVehicleResource')['dex_number'])->toBe(['integer', 'null'])
        ->and($types('ModificationRowResource')['is_registered'])->toBe('boolean')
        ->and($schemas['BuildUpdateResource']['properties']['kind']['$ref'])->toBe('#/components/schemas/BuildUpdateKind')
        ->and($schemas['BuildUpdateKind']['enum'])->toBe(['post', 'before_after'])
        ->and($schemas['StoreBuildUpdatePostRequest']['properties'])->toHaveKeys(['kind', 'modification_id'])
        ->and($types('SpotStatsResource'))->toMatchArray(['total' => 'integer', 'unique_spotters' => 'integer', 'cities_count' => 'integer'])
        ->and($patch)->toBe('#/components/schemas/UpdateVehicleRequest')
        ->and($types('UpdateVehicleRequest'))->toMatchArray(['ghost_mode' => 'boolean', 'spotting_paused' => 'boolean', 'hide_spot_cities' => 'boolean'])
        ->and($schemas['VehicleAttributesRequest']['properties'])->not->toHaveKey('ghost_mode');
});

it('still accepts the STREET DEX switches on PATCH and ignores them on POST', function () {
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/vehicles/{$this->car->id}", ['ghost_mode' => true, 'spotting_paused' => true, 'hide_spot_cities' => true])
        ->assertOk()->assertJsonPath('data.ghost_mode', true)->assertJsonPath('data.spotting_paused', true);
    $this->patchJson("/api/v1/vehicles/{$this->car->id}", ['ghost_mode' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors('ghost_mode');

    $id = $this->postJson('/api/v1/vehicles', ['make_text' => 'Honda', 'model_text' => 'Civic', 'ghost_mode' => true])->assertCreated()->json('data.id');
    expect(Vehicle::query()->find($id)?->ghost_mode)->toBeFalse();
});

it('lets everybody who may see the car see its score and ranks, and only the owner its history (policies)', function () {
    $score = BuildScore::factory()->for($this->car)->create();
    $rank = BuildScoreRank::factory()->for($this->car)->create();
    $history = BuildScoreHistory::factory()->for($this->car)->create();
    $stranger = User::factory()->create();

    expect(Gate::forUser(null)->allows('view', $score))->toBeTrue()
        ->and(Gate::forUser($stranger)->allows('view', $rank))->toBeTrue()
        ->and(Gate::forUser($stranger)->allows('view', $history))->toBeFalse()
        ->and(Gate::forUser($this->owner)->allows('view', $history))->toBeTrue();

    $this->car->forceFill(['visibility' => 'private'])->save();
    $score->unsetRelation('vehicle');
    $rank->unsetRelation('vehicle');

    expect(Gate::forUser(null)->allows('view', $score))->toBeFalse()
        ->and(Gate::forUser($stranger)->allows('view', $rank))->toBeFalse()
        ->and(Gate::forUser($this->owner)->allows('view', $score))->toBeTrue();
});
