<?php

use App\Enums\LegalStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\Media;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Services\BuildScore\BuildScores;
use Carbon\CarbonImmutable;

require_once __DIR__.'/BuildScoreTestHelpers.php';

/**
 * M5.9c (m5.9c contract §3): what the score counts, read from the database. Never a value of power, torque, cost or speed; samples,
 * hidden and deleted content never count; each member counts once per car; blocked members, the owner and deleted members never.
 */
function bsTotal($vehicle): int
{
    return app(BuildScores::class)->recompute($vehicle->id)?->total ?? -1;
}

it('counts usable gallery photos only', function () {
    $car = bsCar();
    Media::factory()->forModel($car)->count(2)->create(['owner_id' => $car->owner_id]);
    Media::factory()->forModel($car)->create(['owner_id' => $car->owner_id, 'status' => MediaStatus::Processing]);
    Media::factory()->forModel($car)->create(['owner_id' => $car->owner_id, 'moderation_status' => ModerationStatus::Rejected]);
    Media::factory()->forModel($car)->create(['owner_id' => $car->owner_id])->delete();

    expect(bsFacts($car)->photos)->toBe(2);
});

it('counts the ten key specs as filled or not, never by their values', function () {
    $car = bsCar(attributes: ['color' => 'Bayside Blue']);
    $specs = new VehicleSpec(['vehicle_id' => $car->id, 'engine_code' => 'RB26', 'displacement_cc' => 2568, 'fuel' => 'petrol', 'aspiration' => 'biturbo', 'torque_nm' => 392, 'drivetrain' => 'all', 'gearbox' => 'manual']);
    $specs->setPower(280, PowerUnit::Ps, PowerSource::Factory)->save();

    // generation (factory), color, engine, displacement, fuel, aspiration, power, torque, drivetrain, gearbox.
    expect(bsFacts($car)->keySpecs)->toBe(10);
    $before = bsTotal($car);

    // Never points for power, torque, cost or money: other values, the same score.
    $specs->setPower(1200, PowerUnit::Ps, PowerSource::Measured)->forceFill(['torque_nm' => 1500])->save();
    $mod = bsMod($car);
    $withMod = bsTotal($car);
    $mod->forceFill(['cost_cents' => 9_900_000, 'cost_public' => true])->save();

    expect($withMod)->toBe($before + 25)
        ->and(bsTotal($car))->toBe($withMod);

    $specs->setPower(null, null)->save();
    expect(bsFacts($car)->keySpecs)->toBe(9);
});

it('counts a description from 200 characters and a cover with a focal point of this car', function () {
    $car = bsCar(attributes: ['description' => str_repeat('a', 199)]);
    $cover = Media::factory()->forModel($car)->create(['owner_id' => $car->owner_id]);
    $car->forceFill(['cover_media_id' => $cover->id])->save();

    expect(bsFacts($car)->descriptionChars)->toBe(199)
        ->and(bsFacts($car)->coverFocal)->toBeFalse();

    $car->forceFill(['description' => '  '.str_repeat('ä', 200).'  '])->save();
    $cover->forceFill(['focal_x' => 0.4, 'focal_y' => 0.6])->save();

    expect(bsFacts($car)->descriptionChars)->toBe(200)
        ->and(bsFacts($car)->coverFocal)->toBeTrue();
});

it('counts a mod as documented with brand, a usable photo and a date; planned mods apart; stated papers as registered', function () {
    $car = bsCar();
    bsMod($car, ['legal_status' => LegalStatus::Registered]);
    bsMod($car, ['brand_text' => null, 'legal_status' => LegalStatus::IndividualApproval]);
    bsMod($car, ['installed_on' => null, 'legal_status' => LegalStatus::Abe]);
    bsMod($car, [], photo: false);
    bsMod($car, ['status' => ModStatus::Planned, 'legal_status' => LegalStatus::Registered]);
    bsMod($car)->delete();
    $rejected = bsMod($car, [], photo: false);
    Media::factory()->forModel($rejected)->create(['owner_id' => $car->owner_id, 'moderation_status' => ModerationStatus::Rejected]);

    $facts = bsFacts($car);

    expect($facts->documentedMods)->toBe(1)
        ->and($facts->undocumentedMods)->toBe(4)
        ->and($facts->existingMods)->toBe(5)
        ->and($facts->registeredMods)->toBe(2)
        ->and($facts->plannedMods)->toBe(1);
});

it('counts each reactor once per car, over the car and its visible updates', function () {
    $car = bsCar();
    $post = bsPost($car);
    $hidden = bsPost($car, ['hidden' => true]);
    $fan = User::factory()->create();
    bsReact($fan, $car);
    bsReact($fan, $post);
    bsReact(User::factory()->create(), $post);
    bsReact(User::factory()->create(), $hidden);
    // Another car's reactions are not this car's.
    bsReact(User::factory()->create(), bsCar());

    expect(bsFacts($car)->reactors)->toBe(2);
});

it('leaves out the owner, deleted members, samples and members blocked either way', function () {
    $owner = User::factory()->create();
    $car = bsCar($owner);
    $counted = User::factory()->create();
    $deleted = User::factory()->create();
    $sample = User::factory()->create(['is_sample' => true]);
    $blockedByOwner = User::factory()->create();
    $blockingOwner = User::factory()->create();

    foreach ([$owner, $counted, $deleted, $sample, $blockedByOwner, $blockingOwner] as $member) {
        bsReact($member, $car);
        bsSpot($member, $car);
        bsFollow($member, $car);
    }

    $deleted->delete();
    bsBlock($owner, $blockedByOwner);
    bsBlock($blockingOwner, $owner);

    $facts = bsFacts($car);

    expect([$facts->reactors, $facts->spotters, $facts->followers])->toBe([1, 1, 1]);

    // A sample member's engagement counts for a sample car only.
    $sampleCar = bsCar(attributes: ['is_sample' => true]);
    bsReact($sample, $sampleCar);
    expect(bsFacts($sampleCar)->reactors)->toBe(1);
});

it('counts spotters once, only counted and not removed spots', function () {
    $car = bsCar();
    $spotter = User::factory()->create();
    bsSpot($spotter, $car);
    bsSpot($spotter, $car, ['created_at' => now()->subDays(3)]);
    bsSpot(User::factory()->create(), $car, ['counted' => false]);
    bsSpot(User::factory()->create(), $car)->delete();

    expect(bsFacts($car)->spotters)->toBe(1);
});

it('counts visible entries the owner wrote, pairs with two usable photos, and the documented span in months', function () {
    $car = bsCar();
    bsPost($car, ['happened_on' => '2023-01-10']);
    bsPost($car, ['type' => 'note', 'happened_on' => null, 'created_at' => now()]);
    bsPost($car, ['hidden' => true, 'happened_on' => '2020-01-01']);
    // A recorded change is no entry of the owner's.
    bsPost($car, ['type' => 'mod_added', 'payload' => ['changes' => []]]);
    bsPair($car);
    bsPair($car, ['status' => MediaStatus::Processing]);
    bsMod($car, ['installed_on' => '2022-06-01']);

    $facts = bsFacts($car);

    expect($facts->timeline)->toBe(4)
        ->and($facts->beforeAfter)->toBe(1)
        ->and($facts->historyMonths)->toBe((int) floor(CarbonImmutable::parse('2022-06-01')->diffInMonths(now()->startOfDay())));
});

it('ignores a pair whose photos are not this update\'s', function () {
    $car = bsCar();
    $update = bsPost($car, ['kind' => 'before_after']);
    $own = Media::factory()->forModel($update)->create(['owner_id' => $car->owner_id]);
    $foreign = Media::factory()->forModel(bsPost($car))->create(['owner_id' => $car->owner_id]);
    $update->forceFill(['photo_pairs' => [[$own->id, $foreign->id]]])->save();

    expect(bsFacts($car)->beforeAfter)->toBe(0);
});
