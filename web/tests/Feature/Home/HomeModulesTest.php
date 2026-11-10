<?php

use App\Actions\Social\BlockMember;
use App\Enums\RestrictionType;
use App\Models\BuildUpdate;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/HomeTestHelpers.php';

/**
 * M2.2 GET home/modules (FS-2): Build-Updates, Aktive Mitglieder, Beliebte Mods diese Woche.
 */
function homeMods(): array
{
    return test()->getJson('/api/v1/home/modules')->assertOk()->json('data');
}

it('answers guests the exact shape, empty lists included', function () {
    $this->getJson('/api/v1/home/modules')->assertOk()
        ->assertExactJson(['data' => ['build_updates' => [], 'active_members' => [], 'popular_mods' => []]])
        ->assertHeader('ETag');
});

describe('build_updates', function () {
    it('takes the newest visible updates, one per build and two per owner, at most three', function () {
        // HOME-01 draws these above the module (hero, the first two Neue Builds), so the module leaves them out (DQ-308).
        homeAbove();
        $busy = User::factory()->create();
        [$a, $b, $c] = [homeBuild($busy), homeBuild($busy), homeBuild($busy)];
        $d = homeBuild();
        $newestOfA = ntfUpdate($a, now()->subMinutes(1)->toDateTimeString());
        ntfUpdate($a, now()->subMinutes(2)->toDateTimeString());
        $ofB = ntfUpdate($b, now()->subMinutes(3)->toDateTimeString());
        ntfUpdate($c, now()->subMinutes(4)->toDateTimeString());
        ntfUpdate($d, now()->subMinutes(5)->toDateTimeString(), hidden: true);
        $ofD = ntfUpdate($d, now()->subMinutes(6)->toDateTimeString());
        ntfUpdate(homeBuild(attributes: ['visibility' => 'private']), now()->toDateTimeString());

        $rows = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/home/modules')->assertOk()->json('data.build_updates');

        expect(array_column($rows, 'id'))->toBe([$newestOfA->id, $ofB->id, $ofD->id])
            ->and(array_keys($rows[0]))->toBe(['id', 'vehicle', 'type_label', 'summary', 'created_at'])
            ->and($rows[0]['vehicle']['id'])->toBe($a->id)
            ->and($rows[0]['type_label'])->toBe('Modifikation hinzugefügt');
    });

    it('leaves out the builds HOME-01 draws above it and fills up from other builds (DQ-308)', function () {
        $viewer = User::factory()->create();
        [$hero, $first, $second, $third] = [homeBuild(hoursAgo: 0.1), homeBuild(hoursAgo: 0.2), homeBuild(hoursAgo: 0.3), homeBuild(hoursAgo: 0.4)];
        config(['speedclub.home.featured_slugs' => [$third->slug]]);
        $older = [homeBuild(hoursAgo: 5), homeBuild(hoursAgo: 6), homeBuild(hoursAgo: 7)];

        foreach ([$hero, $first, $second, $third] as $index => $vehicle) {
            ntfUpdate($vehicle, now()->subMinutes($index + 1)->toDateTimeString());
        }

        $ofOlder = array_map(fn (Vehicle $vehicle, int $index) => ntfUpdate($vehicle, now()->subHours($index + 1)->toDateTimeString()), $older, array_keys($older));
        Sanctum::actingAs($viewer);

        // The hero is the editorial build ($third); the first two Neue Builds are $hero and $first, the builds changed last.
        $rows = homeMods()['build_updates'];
        $vehicles = array_column(array_column($rows, 'vehicle'), 'id');

        expect($vehicles)->toBe([$second->id, $older[0]->id, $older[1]->id])
            ->and(array_column($rows, 'id'))->toBe([
                BuildUpdate::query()->where('vehicle_id', $second->id)->value('id'),
                $ofOlder[0]->id,
                $ofOlder[1]->id,
            ])
            ->and($vehicles)->not->toContain($third->id)->not->toContain($hero->id)->not->toContain($first->id);

        // The stream starts without them too: no update row of a build drawn above, and none of the module's rows.
        $feed = homeReadFeed('for_you', 10);
        expect($feed)->not->toContain('vehicle:'.$third->id)->not->toContain('vehicle:'.$hero->id)->not->toContain('vehicle:'.$first->id);
    });

    it('leaves out builds across a block', function () {
        $viewer = User::factory()->create();
        $vehicle = homeBuild();
        ntfUpdate($vehicle);
        app(BlockMember::class)->handle($viewer, $vehicle->owner);
        Sanctum::actingAs($viewer);

        expect(homeMods()['build_updates'])->toBe([]);
    });
});

describe('active_members', function () {
    it('lists members with a build changed in 14 days, most recent first, with their car and follow state', function () {
        $viewer = ntfMember('lukas.sc');
        $lena = ntfMember('lena.911', ['display_name' => 'Lena Hofmann', 'city' => 'München']);
        $main = homeBuild($lena, hoursAgo: 48, attributes: ['is_main' => true]);
        homeBuild($lena, hoursAgo: 2);
        $kenji = ntfMember('kenji.r34');
        homeBuild($kenji, hoursAgo: 1);
        homeBuild(ntfMember('alt.member'), hoursAgo: 24 * 15);
        homeBuild($viewer, hoursAgo: 0.1);
        socFollow($viewer, $lena);
        Sanctum::actingAs($viewer);

        $members = homeMods()['active_members'];

        expect(array_column($members, 'username'))->toBe(['kenji.r34', 'lena.911'])
            ->and($members[1])->toMatchArray(['display_name' => 'Lena Hofmann', 'city' => 'München', 'is_following' => true])
            ->and($members[1]['car_line'])->toBe(app(VehiclePresenter::class)->fullTitle($main->fresh(['make', 'vehicleModel', 'generation'])))
            ->and($members[0]['is_following'])->toBeFalse()
            ->and($members[1]['car_short'])->toBe(app(VehiclePresenter::class)->shortTitle($main->fresh(['make', 'vehicleModel', 'generation'])))
            // DQ-293 adds car_short after car_line.
            ->and(array_keys($members[0]))->toBe(['username', 'display_name', 'city', 'avatar', 'car_line', 'car_short', 'is_following']);
    });

    it('leaves out members who are not discoverable, hide their name, are blocked or have only private builds', function () {
        $viewer = User::factory()->create();
        homeBuild(ntfMember('versteckt', ['discoverable' => false]));
        homeBuild(ntfMember('anonym', ['show_owner_on_qr' => false]));
        $blocked = ntfMember('geblockt');
        homeBuild($blocked);
        app(BlockMember::class)->handle($blocked, $viewer);
        homeBuild(ntfMember('privat'), attributes: ['visibility' => 'private']);
        homeBuild(ntfMember('sichtbar'));
        Sanctum::actingAs($viewer);

        expect(array_column(homeMods()['active_members'], 'username'))->toBe(['sichtbar']);
    });

    it('stops at twelve', function () {
        collect(range(1, 14))->each(fn () => homeBuild());

        expect(homeMods()['active_members'])->toHaveCount(12);
    });
});

describe('popular_mods', function () {
    beforeEach(fn () => seedModSchema());

    function homeMod(Vehicle $vehicle, string $category, string $brand, ?string $part, float $daysAgo = 1): void
    {
        modIn($vehicle, $category, [], ['brand_text' => $brand, 'part_name' => $part, 'status' => 'installed', 'created_at' => now()->subHours((int) ($daysAgo * 24))]);
    }

    it('names brands with their part when builds of two owners added it this week, then brands alone, most builds first', function () {
        $builds = collect(range(1, 4))->map(fn () => homeBuild());
        homeMod($builds[0], 'suspension', 'KW', 'V3');
        homeMod($builds[1], 'suspension', 'KW', 'V3');
        homeMod($builds[2], 'suspension', 'KW', 'V3');
        homeMod($builds[0], 'wheels_tires', 'BBS', 'LM');
        homeMod($builds[1], 'wheels_tires', 'BBS', 'CH-R');
        homeMod($builds[2], 'exhaust', 'Akrapovič', 'Evolution');
        homeMod($builds[3], 'exhaust', 'Akrapovič', 'Slip-On');
        // One owner alone does not make anything popular.
        homeMod($builds[3], 'brakes', 'Brembo', 'GT');
        homeMod($builds[3], 'brakes', 'Brembo', 'GT');

        $mods = homeMods()['popular_mods'];

        expect($mods)->toBe([
            ['label' => 'KW V3', 'category_key' => 'suspension', 'query' => 'KW V3'],
            ['label' => 'Akrapovič', 'category_key' => 'exhaust', 'query' => 'Akrapovič'],
            ['label' => 'BBS', 'category_key' => 'wheels_tires', 'query' => 'BBS'],
        ]);
    });

    it('looks back 30 days when fewer than three qualify this week, and counts no planned or removed mods', function () {
        $builds = collect(range(1, 2))->map(fn () => homeBuild());
        homeMod($builds[0], 'suspension', 'KW', 'V3', 20);
        homeMod($builds[1], 'suspension', 'KW', 'V3', 20);
        homeMod($builds[0], 'exhaust', 'Remus', null, 40);
        homeMod($builds[1], 'exhaust', 'Remus', null, 40);
        modIn($builds[0], 'wheels_tires', [], ['brand_text' => 'OZ', 'status' => 'planned', 'created_at' => now()->subDay()]);
        modIn($builds[1], 'wheels_tires', [], ['brand_text' => 'OZ', 'status' => 'planned', 'created_at' => now()->subDay()]);

        expect(array_column(homeMods()['popular_mods'], 'label'))->toBe(['KW V3']);
    });

    it('counts only public builds the viewer may see', function () {
        $viewer = User::factory()->create();
        $public = homeBuild();
        $private = homeBuild(attributes: ['visibility' => 'private']);
        $blocked = homeBuild();
        app(BlockMember::class)->handle($viewer, $blocked->owner);
        foreach ([$public, $private, $blocked] as $vehicle) {
            homeMod($vehicle, 'suspension', 'KW', 'V3');
        }
        Sanctum::actingAs($viewer);

        expect(homeMods()['popular_mods'])->toBe([]);
        Sanctum::actingAs(User::factory()->create());
        expect(array_column(homeMods()['popular_mods'], 'label'))->toBe(['KW V3']);
    });
});

it('answers every viewer', function (Closure $who) {
    socActAs($who());

    $this->getJson('/api/v1/home/modules')->assertOk();
})->with([
    'guest' => [fn () => null],
    'member' => [fn () => User::factory()->create()],
    'unverified member' => [fn () => User::factory()->unverified()->create()],
    'restricted member' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
    'deactivated member' => [fn () => User::factory()->deactivated()->create()],
]);

it('reads a fixed number of queries whatever the data', function () {
    $count = function (): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        homeMods();

        return count(DB::getQueryLog());
    };

    seedModSchema();
    // Two builds fill the hero and Neue Builds (DQ-308), so the small page also renders a Build-Updates row.
    homeAbove();
    $few = collect(range(1, 2))->map(fn () => homeBuild(hoursAgo: 3));
    ntfUpdate($few[0]);
    $small = $count();
    collect(range(1, 12))->each(function () {
        $vehicle = homeBuild();
        ntfUpdate($vehicle);
        modIn($vehicle, 'suspension', [], ['brand_text' => 'KW', 'part_name' => 'V3', 'status' => 'installed']);
    });

    expect($count())->toBeLessThanOrEqual($small + 4);
});
