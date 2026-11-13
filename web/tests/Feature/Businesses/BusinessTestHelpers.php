<?php

use App\Models\Business;
use App\Models\FeatureFlag;
use App\Models\ModCategory;
use App\Models\Modification;
use App\Models\Product;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';
require_once __DIR__.'/../Social/SocialTestHelpers.php';

/**
 * M4.14 test helpers, prefixed biz… so they never collide with another file's functions.
 */
function bizFlags(array $flags = []): void
{
    foreach ([...['businesses' => true, 'parts_catalogue' => true, 'editorial_samples' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }

    request()->attributes->remove('speedclub.flags');
}

function bizBusiness(?User $owner = null, array $attributes = []): Business
{
    return Business::factory()->create([...($owner === null ? [] : ['owner_id' => $owner->id]), ...$attributes]);
}

/** A published public build in vehicle_search, with one mod (optionally of a product). */
function bizBuildWithMod(?User $owner = null, ?Product $product = null): Modification
{
    $vehicle = publishedVehicle($owner ?? User::factory()->create());
    $mod = Modification::factory()->create([
        'vehicle_id' => $vehicle->id,
        'category_id' => $product !== null ? $product->category_id : ModCategory::factory(),
        'brand_id' => $product?->brand_id,
        'part_name' => $product?->name,
        'title' => $product !== null ? $product->fullName() : 'Teil',
    ]);

    if ($product !== null) {
        $mod->forceFill(['product_id' => $product->id])->saveQuietly();
    }

    app(VehicleSearchProjector::class)->rebuild($vehicle->id);

    return $mod->refresh();
}

function bizRebuild(Vehicle $vehicle): void
{
    app(VehicleSearchProjector::class)->rebuild($vehicle->id);
}

/** A valid BIZ-02 body: a GmbH in Hamburg (register entry needed). */
function bizBody(array $overrides = []): array
{
    return [
        'name' => 'Fahrwerkstatt Elbe',
        'kind' => 'workshop',
        'legal_name' => 'Fahrwerkstatt Elbe GmbH',
        'legal_form' => 'gmbh',
        'representative' => 'Jana Petersen',
        'street' => 'Hafenstraße 12',
        'postcode' => '20359',
        'city' => 'Hamburg',
        'email' => 'kontakt@fahrwerkstatt.test',
        'register_court' => 'Amtsgericht Hamburg',
        'register_number' => 'HRB 123456',
        'services' => ['Fahrwerk', 'Achsvermessung'],
        'opening_hours' => ['mon' => [['08:00', '17:00']], 'sat' => [['09:00', '12:00']]],
        'accept_terms' => true,
        ...$overrides,
    ];
}
