<?php

use App\Jobs\BuildScore\RecomputeBuildScore;
use App\Models\BuildScore;
use App\Models\BuildScoreHistory;
use App\Models\User;
use App\Services\BuildScore\BuildScores;
use Carbon\CarbonImmutable;
use Illuminate\Bus\UniqueLock;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BuildScoreTestHelpers.php';

/**
 * M5.9c (m5.9c contract §3): the debounced recompute after an edit, the stored row with the total before the last change ("+25") and
 * one history row per Berlin day with a change.
 */
beforeEach(fn () => bsFlags());

it('queues one recompute per car, 30 seconds later, however many edits come in that window', function () {
    Queue::fake();
    $car = bsCar();
    $other = bsCar();
    $scores = app(BuildScores::class);

    $scores->touch($car->id);
    $scores->touch($car->id);
    $scores->touch(strtoupper($car->id));
    $scores->touch($other->id);

    Queue::assertPushed(RecomputeBuildScore::class, 2);
    Queue::assertPushed(RecomputeBuildScore::class, function (RecomputeBuildScore $job) use ($car): bool {
        return $job->vehicleId === strtolower($car->id)
            && $job->delay instanceof DateTimeInterface
            && abs($job->delay->getTimestamp() - now()->addSeconds(30)->getTimestamp()) <= 1;
    });

    // Once the worker starts the job (it releases the lock then), the next edit queues the next run.
    (new UniqueLock(app(Repository::class)))->release(new RecomputeBuildScore(strtolower($car->id)));
    $scores->touch($car->id);

    Queue::assertPushed(RecomputeBuildScore::class, 3);
});

it('stores the score, keeps the total before the last change and one history row per day with a change', function () {
    $this->travelTo(CarbonImmutable::parse('2026-11-14 10:00', 'Europe/Berlin'));
    $car = bsCar();
    $scores = app(BuildScores::class);

    $first = $scores->recompute($car->id);
    expect($first?->previous_total)->toBeNull()
        ->and($first?->stage)->toBe(1)
        ->and($first?->formula_version)->toBe('1')
        ->and($first?->breakdown['key_specs'])->toBe(['points' => 10, 'max' => 100, 'have' => 1]);
    $start = $first->total;

    bsMod($car);
    $second = $scores->recompute($car->id);
    expect($second?->total)->toBe($start + 25)
        ->and($second?->previous_total)->toBe($start)
        ->and($second?->documentation)->toBe(25);

    // Nothing changed: the "+25" stays until the next change.
    $this->travel(5)->minutes();
    expect($scores->recompute($car->id)?->previous_total)->toBe($start);

    // Same day: one history row with the latest total; a later day adds a row.
    expect(BuildScoreHistory::query()->where('vehicle_id', $car->id)->count())->toBe(1)
        ->and(BuildScoreHistory::query()->where('vehicle_id', $car->id)->value('total'))->toBe($start + 25);

    $this->travelTo(CarbonImmutable::parse('2026-11-15 09:00', 'Europe/Berlin'));
    bsMod($car);
    $scores->recompute($car->id);
    expect(BuildScoreHistory::query()->where('vehicle_id', $car->id)->orderBy('day')->pluck('total')->all())->toBe([$start + 25, $start + 50]);
});

it('runs the job against the current state and skips a car that is gone', function () {
    $car = bsCar();
    (new RecomputeBuildScore($car->id))->handle(app(BuildScores::class));
    expect(BuildScore::query()->find($car->id))->not->toBeNull();

    $car->delete();
    expect(app(BuildScores::class)->recompute($car->id))->toBeNull();
});

it('queues a recompute when an edit changes what the score counts, and none for anything else', function () {
    Queue::fake();
    $owner = User::factory()->create();
    $car = bsCar($owner);
    Sanctum::actingAs($owner);

    $this->patchJson("/api/v1/vehicles/{$car->id}", ['nickname' => 'Godzilla'])->assertOk();
    Queue::assertNotPushed(RecomputeBuildScore::class);

    $this->patchJson("/api/v1/vehicles/{$car->id}", ['description' => str_repeat('Schöner Build. ', 20)])->assertOk();
    Queue::assertPushed(RecomputeBuildScore::class, 1);
});

it('queues a recompute for posts, reactions, follows and blocks', function (Closure $act) {
    Queue::fake();
    $owner = User::factory()->create();
    $car = bsCar($owner);
    $member = User::factory()->create();

    $act($this, $owner, $member, $car);

    Queue::assertPushed(RecomputeBuildScore::class, fn (RecomputeBuildScore $job): bool => $job->vehicleId === strtolower($car->id));
})->with([
    'post' => [function ($test, $owner, $member, $car) {
        Sanctum::actingAs($owner);
        $test->postJson('/api/v1/build-updates', ['vehicle_id' => $car->id, 'text' => 'Neue Felgen montiert.'])->assertCreated();
    }],
    'reaction' => [function ($test, $owner, $member, $car) {
        Sanctum::actingAs($member);
        $test->putJson("/api/v1/vehicles/{$car->id}/reactions", ['reaction' => 'clean'])->assertSuccessful();
    }],
    'follow' => [function ($test, $owner, $member, $car) {
        Sanctum::actingAs($member);
        $test->putJson("/api/v1/vehicles/{$car->id}/follow")->assertSuccessful();
    }],
    'block' => [function ($test, $owner, $member, $car) {
        Sanctum::actingAs($owner);
        $test->postJson("/api/v1/users/{$member->username}/block")->assertSuccessful();
    }],
]);

it('shows the new score right after the queued run (sync queue)', function () {
    $owner = User::factory()->create();
    $car = bsCar($owner);
    $before = app(BuildScores::class)->recompute($car->id)?->total;
    Sanctum::actingAs($owner);

    $this->postJson('/api/v1/build-updates', ['vehicle_id' => $car->id, 'text' => 'Ölwechsel und neue Bremsen.'])->assertCreated();

    expect($this->getJson("/api/v1/vehicles/{$car->id}/build-score")->assertOk()->json('data'))
        ->toMatchArray(['total' => $before + 10, 'previous_total' => $before]);
});
