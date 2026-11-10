<?php

use App\Enums\MediaStatus;
use App\Models\Block;
use App\Models\Make;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Database\Seeders\BrandSeeder;
use Database\Seeders\ModCategorySeeder;

/**
 * The real schema of 02_PRODUCT_SPEC §3.3, so the tests exercise what members get.
 */
function seedModSchema(): void
{
    test()->seed([ModCategorySeeder::class, BrandSeeder::class]);
}

function modCategory(string $key): ModCategory
{
    return ModCategory::query()->where('key', $key)->with('fields')->firstOrFail();
}

/**
 * @param  array<string, mixed>  $fields
 * @param  array<string, mixed>  $attributes
 */
function modIn(Vehicle $vehicle, string $category, array $fields = [], array $attributes = []): Modification
{
    return Modification::factory()->create([
        'vehicle_id' => $vehicle->id,
        'category_id' => modCategory($category)->id,
        'brand_id' => null,
        'title' => 'Teil',
        'part_name' => null,
        'installed_on' => null,
        'fields' => $fields,
        ...$attributes,
    ]);
}

/**
 * A published vehicle with one finished photo.
 *
 * @param  array<string, mixed>  $attributes
 */
function publishedVehicle(?User $owner = null, array $attributes = []): Vehicle
{
    $vehicle = Vehicle::factory()->published()->create([...($owner === null ? [] : ['owner_id' => $owner->id]), ...$attributes]);
    Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);

    return $vehicle;
}

/**
 * A draft that has everything publishing asks for.
 */
function completeDraft(User $owner): Vehicle
{
    $vehicle = Vehicle::factory()->create(['owner_id' => $owner->id, 'model_year' => 2020]);
    Media::factory()->forModel($vehicle)->create(['owner_id' => $owner->id, 'status' => MediaStatus::Ready]);

    return $vehicle;
}

function makeWithModel(): Make
{
    return Make::factory()->create();
}

/**
 * Who asks, for the authorisation matrix of member routes. Returns [member or null, expected status or code].
 *
 * @return array<string, array{0: Closure(User): ?User, 1: int}>
 */
function ownerOnlyMatrix(int $success): array
{
    return [
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, $success],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403],
        'member the owner blocked' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 403],
        'member who blocked the owner' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return $member;
        }, 403],
    ];
}

/**
 * The structure of a JSON value with its leaves reduced to their types, for shape snapshots: values change, keys and types must not.
 */
function jsonShape(mixed $value): mixed
{
    if (is_array($value)) {
        if ($value !== [] && array_is_list($value)) {
            return [jsonShape($value[0])];
        }

        return array_map(jsonShape(...), $value);
    }

    return get_debug_type($value);
}
