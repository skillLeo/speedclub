<?php

use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M2.1 social graph test helpers. Prefixed soc… so they never collide with another file's functions.
 */
function socFollow(User $follower, User $followee, ?string $at = null): Follow
{
    return Follow::factory()->create(['follower_id' => $follower->id, 'followee_id' => $followee->id, 'created_at' => $at ?? now()]);
}

function socBlock(User $blocker, User $blocked): Block
{
    return Block::factory()->create(['blocker_id' => $blocker->id, 'blocked_id' => $blocked->id]);
}

function socSavesOn(bool $enabled = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'sig.saved_builds'], ['enabled' => $enabled]);
}

/**
 * One request is allowed, the next one is not.
 */
function socLimit(string $name): void
{
    config(["speedclub.rate_limits.$name.max" => 1]);
    RateLimits::register();
}

/**
 * The authorisation matrix of a route, relative to $member (the other side of the action): each row is who asks (null for a guest),
 * the expected status and, when given, the code. $expect maps the row names below to [status, code|null]; every row must be named, so
 * a matrix cannot leave one out by accident.
 *
 * @param  array<string, array{0: int, 1: string|null}>  $expect
 * @return array<string, array{0: Closure(User): ?User, 1: int, 2: string|null}>
 */
function socMatrix(array $expect): array
{
    $viewers = [
        'guest' => fn (User $member): ?User => null,
        'other member' => fn (User $member): ?User => User::factory()->create(),
        'unverified member' => fn (User $member): ?User => User::factory()->unverified()->create(),
        'member restricted from publishing' => fn (User $member): ?User => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(),
        'member restricted from messaging' => fn (User $member): ?User => User::factory()->restrictedFrom(RestrictionType::Messaging)->create(),
        'suspended member' => fn (User $member): ?User => User::factory()->suspended()->create(),
        'deactivated member' => fn (User $member): ?User => User::factory()->deactivated()->create(),
        'member who blocked the other' => function (User $member): ?User {
            $viewer = User::factory()->create();
            socBlock($viewer, $member);

            return $viewer;
        },
        'member the other blocked' => function (User $member): ?User {
            $viewer = User::factory()->create();
            socBlock($member, $viewer);

            return $viewer;
        },
    ];

    if (array_keys($expect) !== array_keys($viewers)) {
        throw new InvalidArgumentException('socMatrix needs exactly these rows, in this order: '.implode(', ', array_keys($viewers)));
    }

    $rows = [];

    foreach ($viewers as $name => $viewer) {
        $rows[$name] = [$viewer, $expect[$name][0], $expect[$name][1]];
    }

    return $rows;
}

/**
 * Signs in as $viewer for the next request, or stays a guest.
 */
function socActAs(?User $viewer): void
{
    if ($viewer !== null) {
        Sanctum::actingAs($viewer);
    }
}
