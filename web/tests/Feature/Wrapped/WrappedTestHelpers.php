<?php

use App\Enums\Bundesland;
use App\Enums\EventType;
use App\Enums\ModStatus;
use App\Enums\PlateBlurState;
use App\Models\Block;
use App\Models\BuildScore;
use App\Models\BuildScoreHistory;
use App\Models\DeCity;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedPayloadBuilder;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;

/**
 * M5.9e Season Wrapped test helpers, prefixed wr… so they never collide with another file's functions. Every test of the directory
 * lives in the 2027 season and reads it on 2 November 2027 (after Saisonende) unless it travels elsewhere.
 */
const WR_SEASON = '2027-saison';

function wrNow(): CarbonImmutable
{
    return CarbonImmutable::parse('2027-11-02 12:00:00', 'Europe/Berlin');
}

/** A moment inside the 2027 season (Berlin). */
function wrIn(string $date = '2027-06-15 14:00:00'): CarbonImmutable
{
    return CarbonImmutable::parse($date, 'Europe/Berlin');
}

function wrFlags(array $flags = []): void
{
    foreach ([...['wrapped' => true, 'wrapped.countdown' => true, 'editorial_samples' => true, 'events' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }
}

/** Releases the given seasons at the given moments (config defaults; remote config is tested on its own). */
function wrRelease(array $releases = [WR_SEASON => '2027-11-01T10:00:00+01:00']): void
{
    config(['speedclub.wrapped.releases' => $releases]);
    app()->forgetInstance(WrappedReleases::class);
}

/** A published public car of $owner, model year 2015 (never a restomod by accident). */
function wrCar(User $owner, array $attributes = []): Vehicle
{
    return Vehicle::factory()->published()->create(['owner_id' => $owner->id, 'visibility' => 'public', 'model_year' => 2015, ...$attributes]);
}

function wrCategory(string $key): ModCategory
{
    return ModCategory::query()->firstWhere('key', $key) ?? ModCategory::factory()->create(['key' => $key]);
}

function wrMod(Vehicle $car, string $category = 'suspension', array $attributes = []): Modification
{
    return Modification::factory()->create([
        'vehicle_id' => $car->id,
        'category_id' => wrCategory($category)->id,
        'brand_id' => null,
        'brand_text' => 'KW',
        'title' => 'KW V3',
        'status' => ModStatus::Installed,
        'installed_on' => '2027-05-10',
        ...$attributes,
    ]);
}

function wrPhoto(Model $target, User $owner, PlateBlurState $blur = PlateBlurState::Blurred, array $attributes = []): Media
{
    return Media::factory()->forModel($target)->create(['owner_id' => $owner->id, 'plate_blur' => $blur, ...$attributes]);
}

function wrSpot(User $spotter, Vehicle $car, array $attributes = []): Spot
{
    return Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => $spotter->id, 'created_at' => wrIn()->utc(), ...$attributes]);
}

function wrCity(string $name, Bundesland $bundesland = Bundesland::NW): DeCity
{
    return DeCity::query()->firstWhere('name', $name) ?? DeCity::factory()->named($name, $bundesland)->create();
}

function wrEvent(User $member, array $attributes = []): Event
{
    $event = Event::factory()->create([
        'type' => EventType::Meet,
        'starts_at' => wrIn('2027-07-04 18:00:00')->utc(),
        'ends_at' => wrIn('2027-07-04 21:00:00')->utc(),
        ...$attributes,
    ]);
    EventRsvp::factory()->create(['event_id' => $event->id, 'user_id' => $member->id]);

    return $event;
}

function wrScore(Vehicle $car, int $total, array $history = []): BuildScore
{
    foreach ($history as $day => $value) {
        BuildScoreHistory::factory()->create(['vehicle_id' => $car->id, 'day' => $day, 'total' => $value]);
    }

    return BuildScore::factory()->total($total)->create(['vehicle_id' => $car->id]);
}

function wrBlock(User $blocker, User $blocked): void
{
    Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}

/**
 * The stored payload of $member for the 2027 season, or null.
 *
 * @return array<string, mixed>|null
 */
function wrBuild(User $member, string $season = WR_SEASON): ?array
{
    return app(WrappedPayloadBuilder::class)->build($member->fresh() ?? $member, Season::from($season), CarbonImmutable::now());
}

/**
 * One stored card of $member's 2027 payload, or null.
 *
 * @return array<string, mixed>|null
 */
function wrCard(User $member, string $kind): ?array
{
    $payload = wrBuild($member);

    return $payload === null ? null : (collect($payload['cards'])->firstWhere('kind', $kind));
}

/**
 * @return list<string>
 */
function wrKinds(User $member): array
{
    $payload = wrBuild($member);

    return $payload === null ? [] : array_column($payload['cards'], 'kind');
}
