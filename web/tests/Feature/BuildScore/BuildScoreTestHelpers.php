<?php

use App\Enums\BuildUpdateAudience;
use App\Enums\BuildUpdateType;
use App\Enums\LegalStatus;
use App\Enums\ModStatus;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Reaction;
use App\Models\Spot;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleFollow;
use App\Services\BuildScore\BuildScoreFacts;
use App\Services\BuildScore\BuildScoreInputs;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M5.9c Build Score test helpers, prefixed bs… so they never collide with another file's functions.
 */
function bsFlags(array $flags = []): void
{
    foreach ([...['build_reactions' => true, 'vehicle_follow' => true, 'sig.mod_legal_status' => true, 'sig.share_cards' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }
}

/** A published public car (with a generation) of an active, verified member. */
function bsCar(?User $owner = null, array $attributes = []): Vehicle
{
    return Vehicle::factory()->published()->create(['owner_id' => ($owner ?? User::factory()->create())->id, 'visibility' => 'public', ...$attributes]);
}

function bsFacts(Vehicle $vehicle): BuildScoreFacts
{
    return app(BuildScoreInputs::class)->for($vehicle->fresh() ?? $vehicle);
}

function bsCategory(): ModCategory
{
    return ModCategory::query()->first() ?? ModCategory::factory()->create();
}

/** A mod with brand, a usable photo and a date (documented) unless told otherwise. */
function bsMod(Vehicle $vehicle, array $attributes = [], bool $photo = true): Modification
{
    $mod = Modification::factory()->create([
        'vehicle_id' => $vehicle->id,
        'category_id' => bsCategory()->id,
        'title' => 'KW V3',
        'brand_id' => null,
        'brand_text' => 'KW',
        'status' => ModStatus::Installed,
        'installed_on' => '2024-03-01',
        'legal_status' => LegalStatus::Unknown,
        ...$attributes,
    ]);

    if ($photo) {
        Media::factory()->forModel($mod)->create(['owner_id' => $vehicle->owner_id]);
    }

    return $mod;
}

function bsPost(Vehicle $vehicle, array $attributes = []): BuildUpdate
{
    return BuildUpdate::factory()->post()->create(['vehicle_id' => $vehicle->id, 'audience' => BuildUpdateAudience::Vehicle, 'created_at' => now(), ...$attributes]);
}

/** A post with one before/after pair of two photos (both ready unless told otherwise). */
function bsPair(Vehicle $vehicle, array $after = []): BuildUpdate
{
    $update = bsPost($vehicle, ['type' => BuildUpdateType::Post, 'kind' => 'before_after']);
    $before = Media::factory()->forModel($update)->create(['owner_id' => $vehicle->owner_id, 'sort' => 0]);
    $afterPhoto = Media::factory()->forModel($update)->create(['owner_id' => $vehicle->owner_id, 'sort' => 1, ...$after]);
    $update->forceFill(['photo_pairs' => [[$before->id, $afterPhoto->id]]])->save();

    return $update;
}

function bsReact(User $member, Vehicle|BuildUpdate $target): Reaction
{
    return Reaction::factory()->create(['user_id' => $member->id, 'reactable_type' => $target->getMorphClass(), 'reactable_id' => $target->getKey()]);
}

function bsSpot(User $member, Vehicle $vehicle, array $attributes = []): Spot
{
    return Spot::factory()->create(['vehicle_id' => $vehicle->id, 'spotter_id' => $member->id, ...$attributes]);
}

function bsFollow(User $member, Vehicle $vehicle): VehicleFollow
{
    return VehicleFollow::factory()->create(['user_id' => $member->id, 'vehicle_id' => $vehicle->id]);
}

function bsBlock(User $blocker, User $blocked): void
{
    Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}
