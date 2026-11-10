<?php

use App\Models\Follow;
use App\Models\Media;
use App\Models\Save;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Services\Garage\VehicleCompleteness;
use App\Services\Home\HomeRanking;
use App\Services\Home\RankScore;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/HomeTestHelpers.php';

/**
 * M2.2: vehicle_search.rank_score as php artisan home:rank writes it (02_PRODUCT_SPEC §3.8).
 */
/**
 * The score the current epoch reads (review #8: rank_score and rank_score_alt take turns).
 */
function homeScore(string $vehicleId): float
{
    $column = HomeRanking::column(app(HomeRanking::class)->state()['epoch']);

    return (float) VehicleSearch::query()->whereKey($vehicleId)->value($column);
}

it('writes the RankScore of every public build', function () {
    $vehicle = homeBuild(hoursAgo: 72);
    VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['rank_score' => 0]);
    $cover = Media::query()->where('mediable_id', $vehicle->id)->firstOrFail();
    $cover->forceFill(['width' => 1200, 'height' => 800])->save();

    $this->artisan('home:rank')->assertSuccessful()->expectsOutputToContain('Ranked 1 builds.');

    $percent = app(VehicleCompleteness::class)->for($vehicle->fresh(['specs', 'media']), 'de')['percent'];
    expect(homeScore($vehicle->id))->toEqualWithDelta(RankScore::score(72, $percent, 1200, 0, 0, false), 0.0001);
});

it('ranks a fresher, more complete build with a sharper cover higher', function () {
    $fresh = homeBuild(hoursAgo: 1);
    $old = homeBuild(hoursAgo: 24 * 7);
    $small = homeBuild(hoursAgo: 1);
    Media::query()->where('mediable_id', $small->id)->update(['width' => 800, 'height' => 600]);

    homeRank();

    expect(homeScore($fresh->id))->toBeGreaterThan(homeScore($small->id))
        ->and(homeScore($small->id))->toBeGreaterThan(homeScore($old->id));
});

it('adds saves of the last 7 days and new followers of the owner, by active members only', function () {
    $plain = homeBuild();
    $saved = homeBuild();
    $followed = homeBuild();
    Save::factory()->count(3)->create(['vehicle_id' => $saved->id]);
    Save::factory()->create(['vehicle_id' => $saved->id, 'created_at' => now()->subDays(8)]);
    Save::factory()->create(['vehicle_id' => $saved->id, 'user_id' => User::factory()->suspended()->create()->id]);
    Follow::factory()->count(2)->create(['followee_id' => $followed->owner_id]);

    homeRank();

    expect(homeScore($saved->id) - homeScore($plain->id))->toEqualWithDelta(RankScore::engagement(3, 0), 0.00001)
        ->and(homeScore($followed->id) - homeScore($plain->id))->toEqualWithDelta(RankScore::engagement(0, 2), 0.00001);
});

it('boosts the editorial list', function () {
    $plain = homeBuild();
    $boosted = homeBuild();
    config(['speedclub.home.featured_slugs' => [$boosted->slug]]);

    homeRank();

    expect(homeScore($boosted->id) - homeScore($plain->id))->toEqualWithDelta(0.5, 0.00001);
});

it('scores a new projection row at once and leaves existing ones for the hour', function () {
    $vehicle = publishedVehicle();
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);
    $first = homeScore($vehicle->id);
    VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['rank_score' => 0.123456]);

    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    expect($first)->toBeGreaterThan(0)
        ->and(homeScore($vehicle->id))->toBe(0.123456);
});

it('ranks again after a full search rebuild', function () {
    $vehicle = homeBuild();
    VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['rank_score' => 0]);

    $this->artisan('search:rebuild')->assertSuccessful();

    expect(homeScore($vehicle->id))->toBeGreaterThan(0);
});

it('never touches when a build last changed, which Neue Builds orders on', function () {
    $vehicle = homeBuild(hoursAgo: 30);
    $before = VehicleSearch::query()->whereKey($vehicle->id)->value('updated_at');

    homeRank();

    expect(VehicleSearch::query()->whereKey($vehicle->id)->value('updated_at'))->toEqual($before);
});

it('keeps the stream order for a whole hour between runs', function () {
    $builds = collect(range(1, 4))->map(fn (int $i) => homeBuild(hoursAgo: $i * 5));
    homeRank();
    $scores = $builds->map(fn ($vehicle) => homeScore($vehicle->id))->all();

    $this->travel(59)->minutes();

    expect($builds->map(fn ($vehicle) => homeScore($vehicle->id))->all())->toBe($scores);
});

it('reads a fixed number of queries per chunk', function () {
    $count = function (): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        app(HomeRanking::class)->rankAll();

        return count(DB::getQueryLog());
    };

    collect(range(1, 3))->each(fn () => homeBuild());
    $three = $count();
    collect(range(1, 12))->each(fn () => homeBuild());

    // One UPDATE … CASE per chunk and column, everything else per chunk too (review #8, #12).
    expect($count() - $three)->toBe(0);
});
