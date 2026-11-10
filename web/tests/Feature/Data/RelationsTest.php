<?php

use App\Enums\QrRevocationReason;
use App\Enums\RestrictionType;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\IdempotencyKey;
use App\Models\Make;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Modification;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Support\Slug;
use Illuminate\Database\UniqueConstraintViolationException;
use Laravel\Sanctum\Sanctum;

it('links the catalogue chain', function () {
    $make = Make::factory()->create();
    $model = VehicleModel::factory()->for($make)->create();
    $generation = Generation::factory()->create(['model_id' => $model->id]);

    expect($make->models->first()->is($model))->toBeTrue()
        ->and($model->make->is($make))->toBeTrue()
        ->and($model->generations->first()->is($generation))->toBeTrue()
        ->and($generation->vehicleModel->is($model))->toBeTrue();
});

it('merges brands through merged_into_id', function () {
    $target = Brand::factory()->create();
    $duplicate = Brand::factory()->create(['merged_into_id' => $target->id, 'aliases' => ['Akrapovic']]);

    expect($duplicate->mergedInto->is($target))->toBeTrue()
        ->and($duplicate->aliases)->toBe(['Akrapovic']);
});

it('translates category names and field labels', function () {
    $category = ModCategory::factory()->create();
    $field = ModCategoryField::factory()->create(['category_id' => $category->id]);

    app()->setLocale('de');
    expect($category->name)->toBe('Fahrwerk')->and($field->label)->toBe('Tieferlegung vorne');

    app()->setLocale('en');
    expect($category->name)->toBe('Suspension')->and($field->label)->toBe('Lowering front')
        ->and($category->fields->first()->is($field))->toBeTrue()
        ->and($field->category->is($category))->toBeTrue();
});

it('links a vehicle to its owner, catalogue entries and content', function () {
    $vehicle = Vehicle::factory()->published()->create();
    $spec = VehicleSpec::factory()->create(['vehicle_id' => $vehicle->id]);
    $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);
    $media = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);
    $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);
    $search = VehicleSearch::factory()->create(['vehicle_id' => $vehicle->id]);

    expect($vehicle->owner->vehicles->first()->is($vehicle))->toBeTrue()
        ->and($vehicle->specs->is($spec))->toBeTrue()
        ->and($spec->vehicle->is($vehicle))->toBeTrue()
        ->and($vehicle->modifications->first()->is($mod))->toBeTrue()
        ->and($vehicle->media->first()->is($media))->toBeTrue()
        ->and($media->mediable->is($vehicle))->toBeTrue()
        ->and($vehicle->buildUpdates->first()->is($update))->toBeTrue()
        ->and($vehicle->searchProjection->is($search))->toBeTrue()
        ->and($vehicle->vehicleModel->make_id)->toBe($vehicle->make_id)
        ->and($vehicle->generation->model_id)->toBe($vehicle->model_id);
});

it('stores the short morph name, not the class', function () {
    $vehicle = Vehicle::factory()->create();
    $media = Media::factory()->forModel($vehicle)->create();

    expect($media->mediable_type)->toBe('vehicle');
});

it('links avatar and cover media', function () {
    $user = User::factory()->create();
    $avatar = Media::factory()->forModel($user)->create(['owner_id' => $user->id]);
    $user->forceFill(['avatar_media_id' => $avatar->id, 'cover_media_id' => $avatar->id])->save();

    expect($user->avatar->is($avatar))->toBeTrue()
        ->and($user->cover->is($avatar))->toBeTrue()
        ->and($user->media->first()->is($avatar))->toBeTrue();
});

it('counts real followers and following', function () {
    $user = User::factory()->create();
    Follow::factory()->count(2)->create(['followee_id' => $user->id]);
    Follow::factory()->create(['follower_id' => $user->id]);

    expect($user->followers()->count())->toBe(2)
        ->and($user->following()->count())->toBe(1);
});

it('sees a block in both directions', function () {
    [$a, $b, $c] = User::factory()->count(3)->create();
    Block::factory()->create(['blocker_id' => $a->id, 'blocked_id' => $b->id]);

    expect($a->hasBlockWith($b))->toBeTrue()
        ->and($b->hasBlockWith($a))->toBeTrue()
        ->and($a->hasBlockWith($c))->toBeFalse()
        ->and($a->blockedUsers->first()->is($b))->toBeTrue();
});

it('links saved vehicles', function () {
    $save = Save::factory()->create();

    expect($save->user->savedVehicles->first()->is($save->vehicle))->toBeTrue()
        ->and($save->vehicle->saves->first()->is($save))->toBeTrue();
});

it('finds the active QR code of a vehicle', function () {
    $vehicle = Vehicle::factory()->published()->create();
    QrCode::factory()->revoked(QrRevocationReason::Reissued)->create(['vehicle_id' => $vehicle->id]);
    $active = QrCode::factory()->create(['vehicle_id' => $vehicle->id]);
    $scan = QrScanDaily::factory()->create(['qr_code_id' => $active->id, 'count' => 7]);

    expect($vehicle->qrCodes)->toHaveCount(2)
        ->and($vehicle->activeQrCode->is($active))->toBeTrue()
        ->and($active->scans->first()->is($scan))->toBeTrue()
        ->and($scan->qrCode->is($active))->toBeTrue()
        ->and($scan->count)->toBe(7);
});

it('allows one scan row per code and day', function () {
    $scan = QrScanDaily::factory()->create();

    QrScanDaily::factory()->create(['qr_code_id' => $scan->qr_code_id, 'day' => now()->subDay()->toDateString()]);

    expect(fn () => QrScanDaily::factory()->create(['qr_code_id' => $scan->qr_code_id, 'day' => $scan->day->toDateString()]))
        ->toThrow(UniqueConstraintViolationException::class);
});

it('resolves a vehicle by public_id whatever the text part says', function () {
    $vehicle = Vehicle::factory()->create(['public_id' => '7H2KQXMB']);

    expect(Vehicle::findBySlug('bmw-m4-g82-7h2kqxmb')->is($vehicle))->toBeTrue()
        ->and(Vehicle::findBySlug('voellig-anders-7H2KQXMB')->is($vehicle))->toBeTrue()
        ->and(Vehicle::findBySlug('bmw-m4-g82'))->toBeNull()
        ->and(Vehicle::findBySlug('bmw-m4-0000000A'))->toBeNull();
});

it('builds the canonical slug from catalogue names or free text', function () {
    $linked = Vehicle::factory()->create();
    $free = Vehicle::factory()->create([
        'public_id' => '7H2KQXMB', 'make_id' => null, 'model_id' => null, 'generation_id' => null,
        'make_text' => 'Müller', 'model_text' => 'Käfer Spezial', 'slug' => 'x',
    ]);

    expect($linked->canonicalSlug())->toBe($linked->slug)
        ->and($free->canonicalSlug())->toBe(Slug::forVehicle('Müller', 'Käfer Spezial', null, '7H2KQXMB'))
        ->and($free->canonicalSlug())->toBe('mueller-kaefer-spezial-7h2kqxmb');
});

it('soft deletes users, vehicles, modifications and media', function (string $model) {
    $record = $model::factory()->create();
    $record->delete();

    expect($model::query()->whereKey($record->getKey())->exists())->toBeFalse()
        ->and($model::withTrashed()->whereKey($record->getKey())->exists())->toBeTrue();
})->with([User::class, Vehicle::class, Modification::class, Media::class]);

it('removes dependants when the member is hard deleted', function () {
    $vehicle = Vehicle::factory()->create();
    $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);
    $token = PushToken::factory()->create(['user_id' => $vehicle->owner_id]);
    $key = IdempotencyKey::factory()->create(['user_id' => $vehicle->owner_id]);
    $request = CatalogRequest::factory()->create(['user_id' => $vehicle->owner_id, 'vehicle_id' => $vehicle->id]);

    $vehicle->owner->forceDelete();

    expect(Vehicle::withTrashed()->whereKey($vehicle->id)->exists())->toBeFalse()
        ->and(Modification::withTrashed()->whereKey($mod->id)->exists())->toBeFalse()
        ->and(PushToken::query()->whereKey($token->id)->exists())->toBeFalse()
        ->and(IdempotencyKey::query()->whereKey($key->id)->exists())->toBeFalse()
        ->and($request->fresh()->user_id)->toBeNull()
        ->and($request->fresh()->vehicle_id)->toBeNull();
});

it('uses the app token model with device columns', function () {
    expect(Sanctum::$personalAccessTokenModel)->toBe(PersonalAccessToken::class);

    $user = User::factory()->create();
    $result = $user->createToken('phone');
    $result->accessToken->forceFill(['device_name' => 'Pixel 9', 'platform' => 'android', 'app_version' => '1.0.0'])->save();

    expect($result->accessToken)->toBeInstanceOf(PersonalAccessToken::class)
        ->and(PersonalAccessToken::findToken($result->plainTextToken)->device_name)->toBe('Pixel 9')
        ->and($result->accessToken->tokenable_type)->toBe('user')
        ->and($result->accessToken->tokenable->is($user))->toBeTrue();
});

it('reports restrictions and their end', function () {
    $until = now()->addDays(3)->startOfSecond();
    $restricted = User::factory()->restrictedFrom(RestrictionType::Messaging, $until)->create();
    $expired = User::factory()->restrictedFrom(RestrictionType::Messaging, now()->subDay())->create();
    $open = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
    $suspended = User::factory()->suspended($until)->create();
    $lapsed = User::factory()->suspended(now()->subDay())->create();

    expect($restricted->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
        ->and($restricted->isRestrictedFrom(RestrictionType::Publishing))->toBeFalse()
        ->and($restricted->restrictedUntil(RestrictionType::Messaging)->equalTo($until))->toBeTrue()
        ->and($expired->isRestrictedFrom(RestrictionType::Messaging))->toBeFalse()
        ->and($expired->restrictedUntil(RestrictionType::Messaging))->toBeNull()
        ->and($open->isRestrictedFrom(RestrictionType::Publishing))->toBeTrue()
        ->and($open->restrictedUntil(RestrictionType::Publishing))->toBeNull()
        ->and($suspended->isSuspended())->toBeTrue()
        ->and($suspended->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
        ->and($suspended->restrictedUntil(RestrictionType::Publishing)->equalTo($until))->toBeTrue()
        ->and($suspended->isPubliclyVisible())->toBeFalse()
        ->and($lapsed->isSuspended())->toBeFalse()
        ->and($lapsed->isPubliclyVisible())->toBeTrue();
});
