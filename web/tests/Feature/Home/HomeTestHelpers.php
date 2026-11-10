<?php

use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Home\HomeRanking;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M2.2 Home test helpers, prefixed home… so they never collide with another file's functions.
 *
 * A published, public build with a photo, in vehicle_search, last changed $hoursAgo hours ago.
 */
function homeBuild(?User $owner = null, float $hoursAgo = 1, array $attributes = []): Vehicle
{
    $vehicle = publishedVehicle($owner ?? User::factory()->create(), $attributes);
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);
    $at = now()->subMinutes((int) round($hoursAgo * 60));
    DB::table('vehicles')->where('id', $vehicle->id)->update(['updated_at' => $at]);
    VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => $at]);

    return $vehicle;
}

/**
 * Two builds changed last, the first of them editorial: the hero and the first two Neue Builds of HOME-01, without updates.
 *
 * @return list<Vehicle>
 */
function homeAbove(): array
{
    $above = [homeBuild(hoursAgo: 0.05), homeBuild(hoursAgo: 0.06)];
    config(['speedclub.home.featured_slugs' => [$above[0]->slug]]);

    return $above;
}

/**
 * Fixed scores, so a test states the order it means: the first id ranks highest.
 *
 * @param  list<Vehicle>  $vehicles
 */
function homeOrder(array $vehicles): void
{
    $count = count($vehicles);

    foreach (array_values($vehicles) as $index => $vehicle) {
        VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['rank_score' => $count - $index, 'rank_score_alt' => $count - $index]);
    }
}

function homeRank(): void
{
    app(HomeRanking::class)->rankAll();
}

/**
 * Every page of GET feed?tab=for_you (or following) for the signed-in viewer, items as "vehicle:id" / "update:id".
 *
 * @return list<string>
 */
function homeReadFeed(string $tab, int $perPage, int $maxPages = 50): array
{
    $keys = [];
    $cursor = null;

    for ($page = 0; $page < $maxPages; $page++) {
        $response = test()->getJson("/api/v1/feed?tab=$tab&per_page=$perPage".($cursor === null ? '' : '&cursor='.urlencode($cursor)))->assertOk();
        $keys = [...$keys, ...$response->json('data.*.key')];
        $cursor = $response->json('meta.next_cursor');

        if ($cursor === null) {
            return $keys;
        }
    }

    throw new RuntimeException('The feed did not end.');
}
