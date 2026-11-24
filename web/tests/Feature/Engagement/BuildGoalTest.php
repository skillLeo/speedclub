<?php

use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/EngagementTestHelpers.php';

/**
 * M5.7 (10 §6.2, m5.7-contract §4.1): the optional milestone goal "Ziel: Saison 2027" through PATCH vehicles/{id}. Not build news: no
 * Verlauf entry, no updated_at. Shown with the page (`build_goal`), `passed` after its year.
 */
beforeEach(function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00', 'Europe/Berlin'));
    $this->owner = User::factory()->create();
    $this->car = publishedVehicle($this->owner, ['visibility' => Visibility::Public, 'updated_at' => now()->subWeek()]);
});

function engGoal(?User $as, string $vehicleId, mixed $season): TestResponse
{
    app('auth')->forgetGuards();

    if ($as !== null) {
        Sanctum::actingAs($as);
    }

    return test()->patchJson("/api/v1/vehicles/{$vehicleId}", ['build_goal_season' => $season], ['Accept-Language' => 'de']);
}

it('sets the goal without build news, and shows it on the page', function () {
    $updatedAt = $this->car->refresh()->updated_at?->toIso8601String();
    $updates = BuildUpdate::query()->count();

    engGoal($this->owner, $this->car->id, 2027)->assertOk()
        ->assertJsonPath('data.build_goal', ['season' => 2027, 'label' => 'Ziel: Saison 2027', 'passed' => false]);

    expect($this->car->refresh()->getAttribute('build_goal_season'))->toBe(2027)
        ->and($this->car->updated_at?->toIso8601String())->toBe($updatedAt)
        ->and(BuildUpdate::query()->count())->toBe($updates);

    app('auth')->forgetGuards();
    $this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug(), ['Accept-Language' => 'en'])
        ->assertJsonPath('data.build_goal', ['season' => 2027, 'label' => 'Goal: season 2027', 'passed' => false]);
});

it('takes the goal together with other changes', function () {
    app('auth')->forgetGuards();
    Sanctum::actingAs($this->owner);

    $this->patchJson("/api/v1/vehicles/{$this->car->id}", ['build_goal_season' => 2028, 'nickname' => 'Projekt'])->assertOk()
        ->assertJsonPath('data.build_goal.season', 2028)
        ->assertJsonPath('data.nickname', 'Projekt');
});

it('clears the goal with null', function () {
    $this->car->forceFill(['build_goal_season' => 2027])->save();

    engGoal($this->owner, $this->car->id, null)->assertOk()->assertJsonPath('data.build_goal', null);

    expect($this->car->refresh()->getAttribute('build_goal_season'))->toBeNull();
});

it('accepts seasons from this year to ten years ahead', function (mixed $season, bool $valid) {
    $response = engGoal($this->owner, $this->car->id, $season);

    $valid ? $response->assertOk() : $response->assertUnprocessable()->assertJsonValidationErrors('build_goal_season');
})->with([
    'this year' => [2026, true],
    'ten years ahead' => [2036, true],
    'last year' => [2025, false],
    'eleven years ahead' => [2037, false],
    'text' => ['Saison 2027', false],
    'digits as text' => ['2027', true],
    'fraction' => [2027.5, false],
]);

it('stores digits sent as text as the season (review NH)', function () {
    engGoal($this->owner, $this->car->id, '2028')->assertOk()->assertJsonPath('data.build_goal.season', 2028);

    expect($this->car->refresh()->getAttribute('build_goal_season'))->toBe(2028);
});

it('says why in German', function () {
    engGoal($this->owner, $this->car->id, 2020)->assertJsonPath('errors.build_goal_season.0', 'Das Ziel muss eine Saison zwischen 2026 und 2036 sein.');
});

it('marks a goal whose year is over as passed, and still takes it back unchanged', function () {
    $this->car->forceFill(['build_goal_season' => 2026])->save();
    $this->travelTo(CarbonImmutable::parse('2027-02-01 12:00', 'Europe/Berlin'));

    engGoal($this->owner, $this->car->id, 2026)->assertOk()->assertJsonPath('data.build_goal.passed', true);
});

it('belongs to the owner alone', function (Closure $who, int $status, ?string $code) {
    $response = engGoal($who($this->owner), $this->car->id, 2027)->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }

    expect($this->car->refresh()->getAttribute('build_goal_season'))->toBeNull();
})->with([
    'guest' => [fn (): ?User => null, 401, null],
    'other member' => [fn (): User => User::factory()->create(), 403, null],
    'blocked member' => [function (User $owner): User {
        $member = User::factory()->create();
        Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

        return $member;
    }, 403, null],
    'restricted owner' => [function (User $owner): User {
        $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

        return $owner;
    }, 403, 'account_restricted'],
]);

it('puts the goal into the owner\'s data export', function () {
    $this->car->forceFill(['build_goal_season' => 2027])->save();

    $documents = app(ExportContents::class)->documents($this->owner);
    $vehicles = $documents['vehicles.json'];

    expect(collect($vehicles['vehicles'] ?? $vehicles)->firstWhere('id', $this->car->id)['build_goal_season'] ?? null)->toBe(2027)
        ->and($documents)->toHaveKey('insights.json');
});
