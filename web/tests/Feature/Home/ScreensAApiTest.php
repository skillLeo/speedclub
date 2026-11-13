<?php

use App\Enums\CollectionItemType;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\NotificationType;
use App\Models\Brand;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Notification;
use App\Models\Reaction;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Services\Social\Collections;
use App\Services\Social\ViewerStates;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/HomeTestHelpers.php';
require_once __DIR__.'/../Social/SocialTestHelpers.php';
require_once __DIR__.'/../Events/EventTestHelpers.php';

/**
 * M4.8 API for Screens A (HOME-01, HOME-02, DISC-01): reader states on cards, update photos, Build der Woche, nearby events, brands in
 * focus, notification categories and actor car badges, popular models, weekend events, newest builds. Every new field respects blocks,
 * visibility and editorial_samples.
 */
beforeEach(function () {
    Cache::flush();
    foreach (['build_reactions' => true, 'collections' => true, 'events' => true, 'editorial_samples' => true] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }
    request()->attributes->remove('speedclub.flags');
    $this->viewer = User::factory()->create(['username' => 'lena.e30']);
});

describe('reader states and update photos', function () {
    it('tells the reader whether they saved or reacted to a card, and nothing to a guest', function () {
        $saved = homeBuild(hoursAgo: 1);
        $reacted = homeBuild(hoursAgo: 2);
        $plain = homeBuild(hoursAgo: 3);
        app(Collections::class)->add(app(Collections::class)->defaultFor($this->viewer), CollectionItemType::Vehicle, $saved->id);
        Reaction::factory()->create(['user_id' => $this->viewer->id, 'reactable_type' => 'vehicle', 'reactable_id' => $reacted->id, 'type' => 'clean']);
        // Another member's state is never the reader's.
        Reaction::factory()->create(['user_id' => User::factory()->create()->id, 'reactable_type' => 'vehicle', 'reactable_id' => $plain->id, 'type' => 'loud']);

        $this->getJson('/api/v1/home/new-builds?per_page=5')->assertOk()->assertJsonPath('data.0.viewer', null);

        Sanctum::actingAs($this->viewer);
        $cards = collect($this->getJson('/api/v1/home/new-builds?per_page=5')->assertOk()->json('data'))->keyBy('id');

        expect($cards[$saved->id]['viewer'])->toBe(['saved' => true, 'reaction' => null])
            ->and($cards[$reacted->id]['viewer'])->toBe(['saved' => false, 'reaction' => 'clean'])
            ->and($cards[$plain->id]['viewer'])->toBe(['saved' => false, 'reaction' => null]);
    });

    it('loads the states of a whole list in one query each', function () {
        foreach (range(1, 6) as $i) {
            homeBuild(hoursAgo: $i);
        }

        Sanctum::actingAs($this->viewer);
        DB::enableQueryLog();
        $this->getJson('/api/v1/home/new-builds?per_page=6')->assertOk()->assertJsonCount(6, 'data');
        $queries = collect(DB::getQueryLog())->pluck('query');

        expect($queries->filter(fn (string $sql): bool => str_contains($sql, 'member_collection_items'))->count())->toBe(1)
            ->and($queries->filter(fn (string $sql): bool => str_contains($sql, '`reactions`'))->count())->toBe(1);
    });

    it('hides the reaction while build_reactions is off', function () {
        $build = homeBuild();
        Reaction::factory()->create(['user_id' => $this->viewer->id, 'reactable_type' => 'vehicle', 'reactable_id' => $build->id, 'type' => 'clean']);
        FeatureFlag::query()->where('key', 'build_reactions')->update(['enabled' => false]);
        request()->attributes->remove('speedclub.flags');

        expect(app(ViewerStates::class)->of($this->viewer, 'vehicle', $build->id))->toBe(['saved' => false, 'reaction' => null]);
    });

    it('gives update rows their own photos and the reader\'s state', function () {
        homeAbove();
        $build = homeBuild(hoursAgo: 5);
        $update = ntfUpdate($build);
        $photo = Media::factory()->forModel($update)->create(['owner_id' => $build->owner_id, 'sort' => 1]);
        Media::factory()->forModel($update)->create(['owner_id' => $build->owner_id, 'sort' => 2, 'moderation_status' => ModerationStatus::Rejected]);
        Media::factory()->forModel($update)->create(['owner_id' => $build->owner_id, 'sort' => 3, 'status' => MediaStatus::Processing]);
        app(Collections::class)->add(app(Collections::class)->defaultFor($this->viewer), CollectionItemType::BuildUpdate, $update->id);

        Sanctum::actingAs($this->viewer);
        $row = collect($this->getJson('/api/v1/home/modules')->assertOk()->json('data.build_updates'))->firstWhere('id', $update->id);

        expect($row['media'])->toHaveCount(1)
            ->and($row['media'][0]['id'])->toBe($photo->id)
            ->and($row['viewer'])->toBe(['saved' => true, 'reaction' => null])
            ->and($row['vehicle']['viewer'])->toBe(['saved' => false, 'reaction' => null]);
    });
});

describe('home modules', function () {
    it('picks a Build der Woche from the two weeks before this one, with the owner\'s own first sentence', function () {
        $start = CarbonImmutable::now('Europe/Berlin')->startOfWeek(CarbonImmutable::MONDAY);
        $hoursAgo = (float) $start->subDays(3)->diffInHours(now(), true);
        homeAbove();
        $week = homeBuild(hoursAgo: $hoursAgo, attributes: ['description' => 'Mein Alltagsauto mit Herz. Seit 2019 im Aufbau.']);
        $older = homeBuild(hoursAgo: $hoursAgo + 24 * 20);
        homeOrder([$older, $week]);

        $this->getJson('/api/v1/home/modules')->assertOk()
            ->assertJsonPath('data.build_of_week.vehicle.id', $week->id)
            ->assertJsonPath('data.build_of_week.quote', 'Mein Alltagsauto mit Herz.')
            ->assertJsonPath('data.build_of_week.week', $start->isoFormat('GGGG-[W]WW'));

        // A member the owner blocked gets none of it.
        socBlock($week->owner, $this->viewer);
        Sanctum::actingAs($this->viewer);
        $this->getJson('/api/v1/home/modules')->assertOk()->assertJsonPath('data.build_of_week', null);
    });

    it('lists events near the point the device sent, and none without one or with events off', function () {
        $near = evEvent();
        evEvent(null, ['area_lat' => 48.14, 'area_lng' => 11.58, 'lat' => 48.14, 'lng' => 11.58, 'city' => 'München']);

        $this->getJson('/api/v1/home/modules')->assertOk()->assertJsonCount(0, 'data.nearby_events');
        $this->getJson('/api/v1/home/modules?lat=53.55&lng=9.99')->assertOk()->assertJsonCount(1, 'data.nearby_events')
            ->assertJsonPath('data.nearby_events.0.slug', $near->slug);
        $this->getJson('/api/v1/home/modules?lat=95&lng=9.99')->assertUnprocessable()->assertJsonValidationErrors('lat');

        evFlags(['events' => false]);
        $this->getJson('/api/v1/home/modules?lat=53.55&lng=9.99')->assertOk()->assertJsonCount(0, 'data.nearby_events');
    });

    it('counts brands in focus on builds the reader may see only', function () {
        seedModSchema();
        $kw = Brand::factory()->create(['name' => 'Fokus Eins', 'slug' => 'fokus-eins']);
        $bbs = Brand::factory()->create(['name' => 'Fokus Zwei', 'slug' => 'fokus-zwei']);
        foreach ([homeBuild(), homeBuild()] as $build) {
            modIn($build, 'wheels_tires', [], ['brand_id' => $kw->id, 'status' => ModStatus::Installed]);
        }
        modIn(homeBuild(), 'wheels_tires', [], ['brand_id' => $bbs->id, 'status' => ModStatus::Installed]);
        modIn(homeBuild(), 'wheels_tires', [], ['brand_id' => $bbs->id, 'status' => ModStatus::Planned]);
        $private = publishedVehicle(attributes: ['visibility' => 'private']);
        modIn($private, 'wheels_tires', [], ['brand_id' => $bbs->id, 'status' => ModStatus::Installed]);

        $this->getJson('/api/v1/home/modules')->assertOk()
            ->assertJsonPath('data.brands_in_focus.0.slug', 'fokus-eins')
            ->assertJsonPath('data.brands_in_focus.0.vehicle_count', 2)
            ->assertJsonPath('data.brands_in_focus.1.slug', 'fokus-zwei')
            ->assertJsonPath('data.brands_in_focus.1.vehicle_count', 1)
            ->assertJsonPath('data.brands_in_focus.0.cover.id', fn (?string $id): bool => is_string($id));
    });
});

describe('notifications', function () {
    it('filters by category, marks a row unread again and shows the actor\'s car', function () {
        $actor = User::factory()->create(['username' => 'mo.r34']);
        $main = homeBuild($actor, attributes: ['is_main' => true]);
        $follow = Notification::factory()->create(['notifiable_id' => $this->viewer->id, 'type' => NotificationType::NewFollower, 'group_key' => 'new_follower:x', 'actor_count' => 1, 'read_at' => now()]);
        DB::table('notification_actors')->insert(['notification_id' => $follow->id, 'actor_id' => $actor->id, 'created_at' => now()]);
        Notification::factory()->create(['notifiable_id' => $this->viewer->id, 'type' => NotificationType::Security, 'group_key' => null, 'data' => ['event' => 'password_changed']]);
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/notifications?category=social')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'new_follower')
            ->assertJsonPath('data.0.actors.0.username', 'mo.r34')
            ->assertJsonPath('data.0.actors.0.main_vehicle_cover.id', fn (?string $id): bool => is_string($id));
        $this->getJson('/api/v1/notifications?category=system')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.type', 'security');
        $this->getJson('/api/v1/notifications?category=events')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/notifications?category=spam')->assertUnprocessable()->assertJsonValidationErrors('category');

        $this->patchJson("/api/v1/notifications/{$follow->id}", ['read' => false])->assertOk()->assertJsonPath('data.read_at', null);

        // The car goes when the build goes private.
        $main->forceFill(['visibility' => 'private'])->save();
        VehicleSearch::query()->whereKey($main->id)->delete();
        $this->getJson('/api/v1/notifications?category=social')->assertOk()->assertJsonPath('data.0.actors.0.main_vehicle_cover', null);
    });
});

describe('discover', function () {
    it('lists popular models, weekend events and the newest builds', function () {
        $first = homeBuild(hoursAgo: 1);
        homeBuild(hoursAgo: 2, attributes: ['make_id' => $first->make_id, 'model_id' => $first->model_id]);
        homeBuild(hoursAgo: 3);
        $saturday = CarbonImmutable::now('Europe/Berlin')->next(CarbonImmutable::SATURDAY)->setTime(14, 0);
        $weekend = evEvent(null, ['starts_at' => $saturday->utc(), 'ends_at' => $saturday->addHours(4)->utc()]);
        evEvent(null, ['starts_at' => $saturday->addWeeks(2)->utc(), 'ends_at' => $saturday->addWeeks(2)->addHours(4)->utc()]);

        $body = $this->getJson('/api/v1/discover')->assertOk()->json('data');

        expect($body['popular_models'][0]['vehicle_count'])->toBe(2)
            ->and($body['popular_models'][0]['key'])->toContain('--')
            ->and($body['popular_models'][0]['cover'])->not->toBeNull()
            ->and(collect($body['weekend_events'])->pluck('slug')->all())->toBe([$weekend->slug])
            ->and($body['newest'][0]['id'])->toBe($first->id)
            ->and($body['newest'])->toHaveCount(3);
    });

    it('leaves sample builds out of every strip while editorial_samples is off', function () {
        $sample = homeBuild(attributes: ['is_sample' => true]);
        FeatureFlag::query()->where('key', 'editorial_samples')->update(['enabled' => false]);
        request()->attributes->remove('speedclub.flags');

        $body = $this->getJson('/api/v1/discover')->assertOk()->json('data');
        expect(collect($body['newest'])->pluck('id')->all())->not->toContain($sample->id)
            ->and($body['popular_models'])->toBe([]);
    });
});
