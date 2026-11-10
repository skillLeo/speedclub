<?php

use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Home\HomeRanking;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/HomeTestHelpers.php';

/**
 * Wall-clock probe of GET feed?tab=for_you on a few hundred builds (ADR-154: group perf, run alone by the phase gate). The bounds are
 * those of 07_QA §API p95 on a shared PC, with room for load. The query-count check below runs in every suite.
 */
it('serves Für dich pages on 300 builds quickly', function () {
    $owners = User::factory()->count(60)->create();
    $vehicles = Vehicle::factory()->published()->count(300)->sequence(fn ($sequence) => ['owner_id' => $owners[$sequence->index % 60]->id])->create();
    foreach ($vehicles as $vehicle) {
        Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);
    }
    app(VehicleSearchProjector::class)->rebuildAll();

    $started = microtime(true);
    app(HomeRanking::class)->rankAll();
    $rank = microtime(true) - $started;

    Sanctum::actingAs(User::factory()->create());
    $times = [];
    $cursor = null;

    for ($page = 0; $page < 3; $page++) {
        app('auth')->forgetGuards();
        $started = microtime(true);
        $response = $this->getJson('/api/v1/feed?tab=for_you&per_page=20'.($cursor === null ? '' : '&cursor='.urlencode($cursor)))->assertOk();
        $times[] = microtime(true) - $started;
        $cursor = $response->json('meta.next_cursor');
        expect($response->json('data'))->toHaveCount(20);
    }

    expect($times[0])->toBeLessThan(1.5)
        ->and(max(array_slice($times, 1)))->toBeLessThan(1.0)
        ->and($rank)->toBeLessThan(15.0);
})->group('perf');

it('reads a bounded number of queries per page, whatever the number of builds', function () {
    $count = function (?string $cursor = null): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->getJson('/api/v1/feed?tab=for_you&per_page=10'.($cursor === null ? '' : '&cursor='.urlencode($cursor)))->assertOk();

        return count(DB::getQueryLog());
    };

    collect(range(1, 12))->each(fn () => homeBuild());
    homeRank();
    $small = $count();
    collect(range(1, 30))->each(fn () => homeBuild());
    homeRank();

    expect($count())->toBeLessThanOrEqual($small + 6);
});
