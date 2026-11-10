<?php

use App\Models\Save;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Services\Home\HomeRanking;
use App\Support\HomeClock;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/HomeTestHelpers.php';

/**
 * The M2.2 code review (0690ec5) and the fix list B1, Home side.
 */
function homeEpoch(): int
{
    return app(HomeRanking::class)->state()['epoch'];
}

it('leaves only the hero out of the stream, so featured slots 2 and 3 stay on Home (review #2)', function () {
    config(['speedclub.home.featured_limit' => 3, 'speedclub.home.build_update_rows' => 0]);
    $builds = collect(range(1, 6))->map(fn (int $i) => homeBuild(hoursAgo: 24 * $i));
    homeRank();
    $featured = $this->getJson('/api/v1/home/featured')->json('data.*.vehicle.id');
    $newBuilds = $this->getJson('/api/v1/home/new-builds?per_page=2')->json('data.*.id');

    $stream = array_map(fn (string $key) => substr($key, 8), homeReadFeed('for_you', 30));

    expect($featured)->toHaveCount(3)
        ->and($stream)->not->toContain($featured[0])
        ->and(array_values(array_diff(array_slice($featured, 1), $newBuilds)))->each(fn ($id) => $id->toBeIn($stream))
        ->and(count($stream))->toBe(6 - count(array_unique([$featured[0], ...$newBuilds])))
        ->and($builds)->toHaveCount(6);
});

it('names no member in the cursor (review #3)', function () {
    $owners = User::factory()->count(3)->create();
    $owners->each(fn (User $owner) => homeBuild($owner) && homeBuild($owner));
    homeRank();

    $cursor = (string) $this->getJson('/api/v1/feed?tab=for_you&per_page=2')->json('meta.next_cursor');
    $payload = (string) base64_decode(strtr(explode('.', $cursor)[0], '-_', '+/'));

    expect($cursor)->not->toBe('');
    $owners->each(fn (User $owner) => expect($payload)->not->toContain($owner->id));
});

describe('re-ranking while someone scrolls (review #8)', function () {
    it('keeps a cursor on the scores its first page read across one run, without skipping or repeating', function () {
        $builds = collect(range(1, 12))->map(fn (int $i) => homeBuild(hoursAgo: $i));
        DB::table('vehicle_search')->whereIn('vehicle_id', [homeBuild()->id, homeBuild()->id])->update(['updated_at' => now()->addHour()]);
        homeRank();
        $atOnce = homeReadFeed('for_you', 30);

        $first = $this->getJson('/api/v1/feed?tab=for_you&per_page=5')->assertOk();
        // The hour passes and the last builds get saved a lot: the new scores turn the order over.
        $savers = User::factory()->count(20)->create();
        $builds->slice(8)->each(fn ($vehicle) => $savers->each(fn (User $saver) => Save::factory()->create(['vehicle_id' => $vehicle->id, 'user_id' => $saver->id])));
        homeRank();
        $fresh = homeReadFeed('for_you', 30);

        $cursorRest = [];
        $cursor = $first->json('meta.next_cursor');

        while ($cursor !== null) {
            $page = $this->getJson('/api/v1/feed?tab=for_you&per_page=5&cursor='.urlencode($cursor))->assertOk();
            $cursorRest = [...$cursorRest, ...$page->json('data.*.key')];
            $cursor = $page->json('meta.next_cursor');
        }

        expect([...$first->json('data.*.key'), ...$cursorRest])->toBe($atOnce)
            ->and($fresh)->not->toBe($atOnce);
    });

    it('answers 409 feed_stale once the cursor\'s scores are gone, so the app starts over', function () {
        collect(range(1, 8))->each(fn (int $i) => homeBuild(hoursAgo: $i));
        homeRank();
        $cursor = (string) $this->getJson('/api/v1/feed?tab=for_you&per_page=2')->json('meta.next_cursor');

        homeRank();
        $this->getJson('/api/v1/feed?tab=for_you&per_page=2&cursor='.urlencode($cursor))->assertOk();

        homeRank();
        $this->getJson('/api/v1/feed?tab=for_you&per_page=2&cursor='.urlencode($cursor))->assertStatus(409)->assertJsonPath('code', 'feed_stale');
    });

    it('refuses the previous epoch while a run is writing into its column', function () {
        collect(range(1, 6))->each(fn (int $i) => homeBuild(hoursAgo: $i));
        homeRank();
        $cursor = (string) $this->getJson('/api/v1/feed?tab=for_you&per_page=1')->json('meta.next_cursor');
        homeRank();
        DB::table('home_rank_state')->update(['writing' => true]);

        $this->getJson('/api/v1/feed?tab=for_you&per_page=1&cursor='.urlencode($cursor))->assertStatus(409);
    });

    it('switches epochs only after a complete run', function () {
        homeBuild();
        $before = homeEpoch();
        config(['speedclub.home.ranking.max_seconds' => -1]);

        expect(app(HomeRanking::class)->rankAll())->toBeNull()
            ->and(homeEpoch())->toBe($before);

        config(['speedclub.home.ranking.max_seconds' => 45]);
        expect(app(HomeRanking::class)->rankAll())->toBe(1)
            ->and(homeEpoch())->toBe($before + 1)
            ->and(app(HomeRanking::class)->state()['writing'])->toBeFalse();
    });

    it('runs hourly without overlapping', function () {
        $event = collect(app(Schedule::class)->events())->first(fn ($event): bool => str_contains((string) $event->command, 'home:rank'));

        expect($event->withoutOverlapping)->toBeTrue()->and($event->expression)->toBe('0 * * * *');
    });
});

it('counts no saves of the owner for engagement (review #22)', function () {
    $plain = homeBuild();
    $own = homeBuild();
    Save::factory()->create(['vehicle_id' => $own->id, 'user_id' => $own->owner_id]);
    homeRank();

    $column = HomeRanking::column(homeEpoch());
    expect((float) VehicleSearch::query()->whereKey($own->id)->value($column))->toBe((float) VehicleSearch::query()->whereKey($plain->id)->value($column));
});

it('still finds three Build-Updates when one owner posted dozens (review #23)', function () {
    // The hero and the first two Neue Builds are drawn above the module and stay out of it (DQ-308).
    homeAbove();
    $busy = User::factory()->create();
    $vehicles = collect(range(1, 8))->map(fn () => homeBuild($busy, 2));
    foreach (range(1, 40) as $i) {
        ntfUpdate($vehicles[$i % 8], now()->subMinutes($i)->toDateTimeString());
    }
    $others = [homeBuild(hoursAgo: 2), homeBuild(hoursAgo: 2)];
    ntfUpdate($others[0], now()->subDays(2)->toDateTimeString());
    ntfUpdate($others[1], now()->subDays(3)->toDateTimeString());

    $rows = $this->getJson('/api/v1/home/modules')->json('data.build_updates');

    expect($rows)->toHaveCount(3)
        ->and(array_column(array_column($rows, 'vehicle'), 'id'))->toContain($others[0]->id);
});

describe('the Home clock (B1)', function () {
    it('reads the real now unless speedclub.home.clock names a moment', function () {
        expect(HomeClock::now()->diffInSeconds(now()))->toBeLessThan(5);

        config(['speedclub.home.clock' => '2026-10-30 12:00:00']);
        expect(HomeClock::now()->toIso8601String())->toBe('2026-10-30T12:00:00+00:00');

        config(['speedclub.home.clock' => '']);
        expect(HomeClock::now()->diffInSeconds(now()))->toBeLessThan(5);
    });

    it('opens the module windows and the decay at the clock, not at the wall clock', function () {
        config(['speedclub.home.clock' => '2026-06-05 12:00:00']);
        $vehicle = homeBuild(ntfMember('aktiv'));
        DB::table('vehicle_search')->where('vehicle_id', $vehicle->id)->update(['updated_at' => '2026-06-03 12:00:00']);
        homeRank();

        expect($this->getJson('/api/v1/home/modules')->json('data.active_members.*.username'))->toBe(['aktiv']);
        $score = (float) VehicleSearch::query()->whereKey($vehicle->id)->value(HomeRanking::column(homeEpoch()));
        expect($score)->toBeGreaterThan(0.1);

        config(['speedclub.home.clock' => null]);
        expect($this->getJson('/api/v1/home/modules')->json('data.active_members'))->toBe([]);
    });

    it('is empty outside local, so production and staging read the real now', function () {
        expect(config('speedclub.home.clock'))->toBeNull();
    });
});
