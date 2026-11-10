<?php

use App\Actions\Garage\DeleteModification;
use App\Actions\Garage\DeleteVehicle;
use App\Actions\Garage\SaveModification;
use App\Actions\Garage\SetMainVehicle;
use App\Actions\Garage\UpdateVehicleSpecs;
use App\Enums\BuildUpdateType;
use App\Enums\ErrorCode;
use App\Enums\MediaStatus;
use App\Enums\RestrictionType;
use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSearch;
use App\Services\Media\MediaService;
use App\Services\Search\RebuildVehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Http\Testing\File;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * The second review of M1.6 and SEC-M16-08 to 10, each finding proved here through what a member or a guest can reach.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
});

/**
 * @return list<string> every statement the callback runs, in order
 */
function hardeningQueries(Closure $callback): array
{
    $queries = [];
    DB::listen(function ($query) use (&$queries): void {
        $queries[] = $query->sql;
    });

    $callback();

    return $queries;
}

function hardeningUpload(): File
{
    return UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(640, 480));
}

/**
 * @param  list<string>  $ids
 * @return list<array<string, mixed>>
 */
function bigChanges(array $ids): array
{
    $fields = ['wheel_brand' => str_repeat('B', 120), 'wheel_model' => str_repeat('M', 120), 'diameter' => 19, 'width' => 9.5];

    return array_map(fn (string $id): array => [
        'kind' => BuildUpdateType::ModChanged->value, 'category' => 'wheels_tires', 'modification_id' => $id,
        'before' => ['title' => str_repeat('A', 160), 'status' => 'installed', 'fields' => $fields],
        'after' => ['title' => str_repeat('C', 160), 'status' => 'installed', 'fields' => [...$fields, 'diameter' => 20]],
    ], $ids);
}

describe('brand fields', function () {
    it('answers 422 instead of 500 above the column of a brand, and takes the column\'s length', function (string $category, string $key) {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => $category, 'fields' => [$key => str_repeat('b', 121)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor("fields.$key");

        $created = $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => $category, 'fields' => [$key => str_repeat('b', 120)]])
            ->assertCreated();

        $this->patchJson('/api/v1/mods/'.$created->json('data.id'), ['fields' => [$key => str_repeat('b', 121)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor("fields.$key");

        expect(Modification::query()->findOrFail($created->json('data.id'))->getAttribute('brand_text'))->toBe(str_repeat('b', 120));
    })->with([
        'wheels' => ['wheels_tires', 'wheel_brand'],
        'suspension' => ['suspension', 'brand'],
        'engine' => ['engine_performance', 'tuner'],
    ]);

    it('keeps 160 characters for plain text', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => ['wheel_model' => str_repeat('m', 160)]])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => ['wheel_model' => str_repeat('m', 161)]])
            ->assertUnprocessable()
            ->assertJsonValidationErrorFor('fields.wheel_model');
    });
});

describe('build updates under a restriction', function () {
    it('lets a restricted owner hide, not show again, and the guest never reads the note', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = publishedVehicle($member);
        $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id, 'type' => BuildUpdateType::Note, 'note' => 'GEHEIME-NOTIZ', 'hidden' => true]);
        Sanctum::actingAs($member);

        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => false])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');

        expect($update->fresh()?->hidden)->toBeTrue();

        $member->forceFill(['status' => 'active'])->save();
        app('auth')->forgetGuards();

        expect((string) $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates')->getContent())->not->toContain('GEHEIME-NOTIZ');
    });

    it('does not tell a stranger under a restriction anything about the entry', function () {
        $update = BuildUpdate::factory()->create(['vehicle_id' => publishedVehicle($this->owner)->id, 'hidden' => true]);
        Sanctum::actingAs(User::factory()->create());

        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => false])->assertForbidden()->assertJsonMissingPath('until');
    });

    it('lets everybody else show again', function () {
        $update = BuildUpdate::factory()->create(['vehicle_id' => publishedVehicle($this->owner)->id, 'hidden' => true]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => false])->assertOk()->assertJsonPath('data.hidden', false);
    });
});

describe('power in the history', function () {
    it('shows the provenance, so a dyno run reads as a difference', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'claimed'])->assertOk();
        $this->travel(11)->minutes();
        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();

        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates')
            ->assertOk()
            ->assertJsonPath('data.0.summary', "Leistung: 510 PS (375 kW) · Besitzerangabe \u{2192} 510 PS (375 kW) · Gemessen");
    });

    it('makes no entry when only the unit of the same power changed', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();
        BuildUpdate::query()->where('vehicle_id', $vehicle->id)->update(['open_until' => null]);
        $this->travel(11)->minutes();
        $count = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->count();

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 375, 'power_unit' => 'kw', 'power_source' => 'measured'])->assertOk();

        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->count())->toBe($count);
    });

    it('drops an open entry when a change of unit brings the same power back', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();
        BuildUpdate::query()->where('vehicle_id', $vehicle->id)->delete();

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 520, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();
        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->count())->toBe(1);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 375, 'power_unit' => 'kw', 'power_source' => 'measured'])->assertOk();
        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->count())->toBe(0);
    });

    it('still records a real change entered in another unit', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();
        $this->travel(11)->minutes();
        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 380, 'power_unit' => 'kw', 'power_source' => 'measured'])->assertOk();

        $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug().'/updates')
            ->assertJsonPath('data.0.changes.0.after', '517 PS (380 kW) · Gemessen');
    });
});

describe('main vehicle with stale models', function () {
    it('does not move main onto a vehicle deleted meanwhile', function () {
        $a = publishedVehicle($this->owner, ['is_main' => true]);
        $b = publishedVehicle($this->owner);
        $stale = Vehicle::query()->findOrFail($b->id);

        app(DeleteVehicle::class)->handle($this->owner, $b);
        app(SetMainVehicle::class)->handle($this->owner, $stale);

        expect($this->owner->vehicles()->where('is_main', true)->pluck('id')->all())->toBe([$a->id])
            ->and(Vehicle::withTrashed()->findOrFail($b->id)->is_main)->toBeFalse();
    });

    it('hands over when the deleted vehicle became main after it was read', function () {
        $a = publishedVehicle($this->owner, ['is_main' => true]);
        $d = publishedVehicle($this->owner);
        $stale = Vehicle::query()->findOrFail($d->id);

        app(SetMainVehicle::class)->handle($this->owner, Vehicle::query()->findOrFail($d->id));
        app(DeleteVehicle::class)->handle($this->owner, $stale);

        expect($this->owner->vehicles()->where('is_main', true)->pluck('id')->all())->toBe([$a->id])
            ->and(Vehicle::withTrashed()->findOrFail($d->id)->is_main)->toBeFalse();
    });

    it('does not make a draft main, whatever was read before', function () {
        $a = publishedVehicle($this->owner, ['is_main' => true]);
        $b = publishedVehicle($this->owner);
        $stale = Vehicle::query()->findOrFail($b->id);
        Vehicle::query()->whereKey($b->id)->update(['status' => 'draft']);

        app(SetMainVehicle::class)->handle($this->owner, $stale);

        expect($this->owner->vehicles()->where('is_main', true)->pluck('id')->all())->toBe([$a->id]);
    });
});

describe('locks', function () {
    it('takes the vehicle\'s lock before it looks at the specs', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);

        $queries = hardeningQueries(fn () => app(UpdateVehicleSpecs::class)->handle($vehicle, ['torque_nm' => 500]));
        $lock = collect($queries)->search(fn (string $sql): bool => str_contains($sql, '`vehicles`') && str_contains($sql, 'for update'));
        $specs = collect($queries)->search(fn (string $sql): bool => str_contains($sql, 'from `vehicle_specs`'));

        expect($lock)->toBeInt()
            ->and($specs)->toBeInt()
            ->and($lock)->toBeLessThan($specs);
    });

    it('locks the vehicle before it deletes a modification, in the order an edit takes', function () {
        $mod = modIn(publishedVehicle($this->owner), 'exhaust');

        $queries = hardeningQueries(fn () => app(DeleteModification::class)->handle($mod));
        $lock = collect($queries)->search(fn (string $sql): bool => str_contains($sql, '`vehicles`') && str_contains($sql, 'for update'));
        $delete = collect($queries)->search(fn (string $sql): bool => str_starts_with($sql, 'update `modifications`'));

        expect($lock)->toBeInt()
            ->and($delete)->toBeInt()
            ->and($lock)->toBeLessThan($delete);
    });

    it('answers 404 for a modification deleted while an edit waited, and leaves the removal in history', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust', ['brand' => 'Akrapovic'], ['title' => 'Akrapovic']);
        $stale = Modification::query()->findOrFail($mod->id);

        app(DeleteModification::class)->handle($mod);
        $update = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->sole();
        $payload = $update->payload;

        expect(fn () => app(SaveModification::class)->change($stale, ['notes' => 'zu spät']))->toThrow(function (ApiException $exception): void {
            expect($exception->errorCode)->toBe(ErrorCode::NotFound);
        });

        expect($update->fresh()?->payload)->toEqual($payload)
            ->and(Modification::withTrashed()->findOrFail($mod->id)->trashed())->toBeTrue()
            ->and(Modification::withTrashed()->findOrFail($mod->id)->getAttribute('notes'))->not->toBe('zu spät');
    });

    it('compares an edit against what is stored now, not what was read before the lock', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust', ['brand' => 'Remus'], ['title' => 'Remus']);
        $stale = Modification::query()->findOrFail($mod->id);

        app(SaveModification::class)->change($mod, ['fields' => ['brand' => 'Akrapovic']]);
        app(SaveModification::class)->change($stale, ['fields' => ['brand' => 'Eisenmann']]);

        $change = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->sole()->payload['changes'][0];

        expect($change['before']['fields']['brand'])->toBe('Remus')
            ->and($change['after']['fields']['brand'])->toBe('Eisenmann');
    });

    it('removes a modification once when two deletes were read together', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        $stale = Modification::query()->findOrFail($mod->id);

        app(DeleteModification::class)->handle($mod);
        $payload = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->sole()->payload;
        app(DeleteModification::class)->handle($stale);

        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->sole()->payload)->toEqual($payload);
    });
});

describe('search projection', function () {
    it('takes the first wheels in the member\'s order, as the page does, and a reorder rebuilds', function () {
        $vehicle = publishedVehicle($this->owner);
        $bbs = modIn($vehicle, 'wheels_tires', ['diameter' => 19], ['sort' => 1]);
        $oz = modIn($vehicle, 'wheels_tires', ['diameter' => 20], ['sort' => 2]);
        $projector = app(VehicleSearchProjector::class);

        $projector->rebuild($vehicle->id);
        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('wheel_diameter'))->toBe(19.0);

        Sanctum::actingAs($this->owner);
        Queue::fake();

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/mods/order", ['ids' => [$oz->id, $bbs->id]])->assertOk();

        Queue::assertPushed(RebuildVehicleSearch::class, fn (RebuildVehicleSearch $job): bool => $job->vehicleId === $vehicle->id);

        $projector->rebuild($vehicle->id);
        expect(VehicleSearch::query()->findOrFail($vehicle->id)->getAttribute('wheel_diameter'))->toBe(20.0);
    });

    it('queues nothing for an order that stays the same', function () {
        $vehicle = publishedVehicle($this->owner);
        $first = modIn($vehicle, 'exhaust', [], ['sort' => 1]);
        $second = modIn($vehicle, 'brakes', [], ['sort' => 2]);
        Sanctum::actingAs($this->owner);
        Queue::fake();

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/mods/order", ['ids' => [$first->id, $second->id]])->assertOk();

        Queue::assertNotPushed(RebuildVehicleSearch::class);
    });

    /**
     * @return array<string, Closure>
     */
    dataset('garage changes', [
        'a mod added' => [fn (Vehicle $vehicle) => test()->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertCreated()],
        // Something others read: notes alone move nothing (SEC-M18-03, DiscoverPrivateEditTest).
        'a mod changed' => [fn (Vehicle $vehicle) => test()->patchJson('/api/v1/mods/'.modIn($vehicle, 'brakes')->id, ['title' => 'Bremse neu'])->assertOk()],
        'a mod removed' => [fn (Vehicle $vehicle) => test()->deleteJson('/api/v1/mods/'.modIn($vehicle, 'aero_body')->id)->assertNoContent()],
        'specs' => [fn (Vehicle $vehicle) => test()->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['torque_nm' => 500])->assertOk()],
        'a photo' => [fn (Vehicle $vehicle) => test()->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated()],
        'a mod photo' => [fn (Vehicle $vehicle) => test()->post('/api/v1/mods/'.modIn($vehicle, 'interior')->id.'/media', ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated()],
    ]);

    it('moves "last updated" with every change, on the vehicle and in the projection', function (Closure $change) {
        $vehicle = publishedVehicle($this->owner);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => now()->subDays(3)]);
        VehicleSearch::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => now()->subDays(3)]);
        Sanctum::actingAs($this->owner);
        $this->travel(10)->minutes();

        $change($vehicle);

        $expected = now()->toDateTimeString();

        expect(Vehicle::query()->findOrFail($vehicle->id)->updated_at?->toDateTimeString())->toBe($expected)
            ->and(VehicleSearch::query()->findOrFail($vehicle->id)->updated_at?->toDateTimeString())->toBe($expected);
    })->with('garage changes');

    it('does not call a rebuild without a change an update', function () {
        $this->freezeTime();
        $vehicle = publishedVehicle($this->owner);
        Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => now()->subDays(3)]);
        $projector = app(VehicleSearchProjector::class);
        $projector->rebuild($vehicle->id);
        $this->travel(10)->minutes();

        $projector->rebuild($vehicle->id);
        // Also when another column of the row has to change, here because the owner's name is part of nothing but his status.
        $this->owner->forceFill(['status' => 'suspended'])->save();
        $projector->rebuild($vehicle->id);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->updated_at?->toDateTimeString())->toBe(now()->subMinutes(10)->subDays(3)->toDateTimeString());
    });

    it('does not count an edit that changes nothing', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust', [], ['notes' => 'gleich']);
        Vehicle::query()->whereKey($vehicle->id)->toBase()->update(['updated_at' => now()->subDays(3)]);
        Sanctum::actingAs($this->owner);
        Queue::fake();

        $this->patchJson("/api/v1/mods/{$mod->id}", ['notes' => 'gleich'])->assertOk();

        expect(Vehicle::query()->findOrFail($vehicle->id)->updated_at?->isToday())->toBeFalse();
        Queue::assertNotPushed(RebuildVehicleSearch::class);
    });
});

describe('limits on writes', function () {
    it('throttles every write of the garage, media and follows', function () {
        $writes = array_filter(Route::getRoutes()->getRoutes(), fn (LaravelRoute $route): bool => Str::contains($route->getActionName(), ['Api\V1\Garage', 'Api\V1\Media', 'Api\V1\Social'])
            && array_intersect($route->methods(), ['POST', 'PUT', 'PATCH', 'DELETE']) !== []);
        $missing = [];

        foreach ($writes as $route) {
            if (array_filter($route->gatherMiddleware(), fn (mixed $name): bool => is_string($name) && str_starts_with($name, 'throttle:')) === []) {
                $missing[] = $route->getName();
            }
        }

        expect(count($writes))->toBeGreaterThan(20)->and($missing)->toBe([]);
    });

    it('counts publish against the creating writes', function () {
        expect(Route::getRoutes()->getByName('api.v1.vehicles.publish')?->gatherMiddleware())->toContain('throttle:garage-writes');
    });

    it('stops a repeated edit with 429', function (Closure $edit) {
        config(['speedclub.rate_limits.garage_edits.max' => 2]);
        RateLimits::register();
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        foreach (range(1, 2) as $i) {
            $edit($vehicle, $i)->assertSuccessful();
        }

        $edit($vehicle, 3)->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    })->with([
        'PATCH vehicle' => [fn (Vehicle $vehicle, int $i) => test()->patchJson("/api/v1/vehicles/{$vehicle->id}", ['color' => 'Farbe'.$i])],
        'PUT specs' => [fn (Vehicle $vehicle, int $i) => test()->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['torque_nm' => 100 + $i])],
        'PATCH visibility' => [fn (Vehicle $vehicle, int $i) => test()->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])],
    ]);

    it('stops repeated unfollows, without touching the budget for following', function () {
        config(['speedclub.rate_limits.unfollows.max' => 2]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        foreach (range(1, 2) as $i) {
            $this->deleteJson('/api/v1/users/niemand/follow')->assertOk();
        }

        $this->deleteJson('/api/v1/users/niemand/follow')->assertTooManyRequests();
        $this->postJson('/api/v1/users/'.User::factory()->create(['username' => 'andere.r'])->username.'/follow')->assertOk();
    });

    it('collapses a burst of edits into one queued rebuild', function () {
        Queue::fake();
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        // Edits others can read: one of notes alone queues nothing at all (SEC-M18-03, DiscoverPrivateEditTest).
        foreach (range(1, 5) as $i) {
            $this->patchJson("/api/v1/mods/{$mod->id}", ['title' => 'Auspuff '.$i])->assertOk();
        }

        Queue::assertPushed(RebuildVehicleSearch::class, 1);
    });

    it('keeps one rebuild per vehicle, not one in total', function () {
        Queue::fake();
        $projector = app(VehicleSearchProjector::class);

        $projector->queue(publishedVehicle($this->owner));
        $projector->queue(publishedVehicle($this->owner));

        Queue::assertPushed(RebuildVehicleSearch::class, 2);
    });

    it('releases the uniqueness before the work, so a change during a rebuild still gets one', function () {
        expect(new RebuildVehicleSearch('x'))->toBeInstanceOf(ShouldBeUniqueUntilProcessing::class)
            ->and((new RebuildVehicleSearch('x'))->uniqueId())->toBe('x');

        $vehicle = publishedVehicle($this->owner);

        // The sync queue runs the whole cycle: each dispatch gets through, since the one before has started.
        app(VehicleSearchProjector::class)->queue($vehicle);
        VehicleSearch::query()->whereKey($vehicle->id)->delete();
        app(VehicleSearchProjector::class)->queue($vehicle);

        expect(VehicleSearch::query()->whereKey($vehicle->id)->exists())->toBeTrue();
    });

    it('takes no uniqueness for a transaction that rolls back', function () {
        Queue::fake();
        $vehicle = publishedVehicle($this->owner);
        $projector = app(VehicleSearchProjector::class);

        try {
            DB::transaction(function () use ($projector, $vehicle): void {
                $projector->queue($vehicle);

                throw new RuntimeException('rollback');
            });
        } catch (RuntimeException) {
        }

        Queue::assertNotPushed(RebuildVehicleSearch::class);

        DB::transaction(fn () => $projector->queue($vehicle));

        Queue::assertPushed(RebuildVehicleSearch::class, 1);
    });
});

describe('the cost of Verlauf', function () {
    it('renders a bounded row on every list, with the total, however big an entry is', function () {
        $vehicle = publishedVehicle($this->owner);
        $changes = bigChanges(array_map(fn (): string => (string) Str::ulid(), range(1, 200)));

        foreach (range(1, 40) as $i) {
            $update = new BuildUpdate(['type' => BuildUpdateType::ModChanged, 'payload' => ['changes' => $changes]]);
            $update->forceFill(['vehicle_id' => $vehicle->id, 'created_at' => now()->subDays($i)])->save();
        }

        $slug = $vehicle->canonicalSlug();

        $this->getJson("/api/v1/public/vehicles/$slug/updates?per_page=31")->assertUnprocessable()->assertJsonValidationErrorFor('per_page');

        $list = $this->getJson("/api/v1/public/vehicles/$slug/updates?per_page=30")->assertOk();
        $row = $list->json('data.0');

        expect(strlen((string) $list->getContent()))->toBeLessThan(2 * 1024 * 1024)
            ->and($list->json('data'))->toHaveCount(30)
            ->and($row['changes'])->toHaveCount(20)
            ->and($row['changes_count'])->toBe(200)
            ->and($row['changes'][0]['details'])->toBe([])
            ->and($row['summary'])->toContain('180');

        $page = $this->getJson("/api/v1/public/vehicles/$slug")->assertOk();

        expect(strlen((string) $page->getContent()))->toBeLessThan(2 * 1024 * 1024)
            ->and($page->json('data.updates.0.changes'))->toHaveCount(20)
            ->and($page->json('data.updates.0.changes_count'))->toBe(200);

        Sanctum::actingAs($this->owner);
        $member = $this->getJson("/api/v1/vehicles/{$vehicle->id}/updates")->assertOk();

        expect($member->json('data.0.changes'))->toHaveCount(20);
    });

    it('keeps everything on the detail route of VEH-05', function () {
        $vehicle = publishedVehicle($this->owner);
        $update = new BuildUpdate(['type' => BuildUpdateType::ModChanged, 'payload' => ['changes' => bigChanges(array_map(fn (): string => (string) Str::ulid(), range(1, 25)))]]);
        $update->forceFill(['vehicle_id' => $vehicle->id, 'created_at' => now()])->save();

        $detail = $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug()."/updates/{$update->id}")->assertOk();

        expect($detail->json('data.changes'))->toHaveCount(25)
            ->and($detail->json('data.changes_count'))->toBe(25)
            ->and($detail->json('data.changes.0.details'))->not->toBe([]);
    });

    it('starts a new entry once the open one is full, so no window grows without end', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);
        $mods = array_map(fn (int $i): Modification => modIn($vehicle, 'exhaust', [], ['title' => 'Teil '.$i]), range(1, 21));

        foreach ($mods as $mod) {
            $this->patchJson("/api/v1/mods/{$mod->id}", ['title' => 'Neu'])->assertOk();
        }

        $rows = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->orderBy('created_at')->orderBy('id')->get();
        $sizes = $rows->map(fn (BuildUpdate $update): int => count($update->payload['changes']))->sort()->values()->all();

        expect($sizes)->toBe([1, 20])
            ->and($rows->whereNotNull('open_until')->count())->toBe(1);

        // Merging into the full entry was over when it closed, and the mod's next edit goes to the new one.
        $this->patchJson("/api/v1/mods/{$mods[0]->id}", ['title' => 'Noch neuer'])->assertOk();

        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->count())->toBe(2);
    });
});

describe('storage per member', function () {
    beforeEach(function () {
        config(['speedclub.media.quota_mb' => 2, 'speedclub.media.quota_unverified_mb' => 1]);
    });

    /**
     * An existing photo that takes the given bytes.
     */
    function storedPhoto(User $owner, Vehicle $vehicle, int $bytes): Media
    {
        $media = Media::factory()->forModel($vehicle)->create(['owner_id' => $owner->id]);
        $media->forceFill(['original_bytes' => $bytes, 'variant_bytes' => 0])->save();

        return $media;
    }

    it('records what a photo takes on disk', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $id = $this->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        $media = Media::query()->findOrFail($id);

        expect((int) $media->getAttribute('original_bytes'))->toBe(Storage::disk('local')->size((string) $media->getAttribute('original_path')))
            ->and((int) $media->getAttribute('variant_bytes'))->toBeGreaterThan(0);
    });

    it('refuses an upload above the allowance, on vehicles and mods, and what was there stays', function () {
        $vehicle = publishedVehicle($this->owner);
        storedPhoto($this->owner, $vehicle, 2 * 1024 * 1024);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);
        $count = Media::query()->count();

        $this->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrorFor('file');
        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrorFor('file');

        expect(Media::query()->count())->toBe($count);
    });

    it('gives an account without a proved address a smaller allowance, enough for a draft', function () {
        $member = User::factory()->unverified()->create();
        $draft = Vehicle::factory()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->post("/api/v1/vehicles/{$draft->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated();

        storedPhoto($member, $draft, 1024 * 1024);

        $this->post("/api/v1/vehicles/{$draft->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrorFor('file');

        $member->forceFill(['email_verified_at' => now()])->save();

        $this->post("/api/v1/vehicles/{$draft->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated();
    });

    it('counts other members for nobody', function () {
        $other = User::factory()->create();
        storedPhoto($other, publishedVehicle($other), 2 * 1024 * 1024);
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated();
    });

    it('frees the public files of a deleted photo and keeps counting the original until the hard delete', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);
        $id = $this->post("/api/v1/vehicles/{$vehicle->id}/media", ['file' => hardeningUpload()], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        $original = (int) Media::query()->findOrFail($id)->getAttribute('original_bytes');

        $this->deleteJson("/api/v1/media/$id")->assertNoContent();

        $media = Media::withTrashed()->findOrFail($id);

        expect((int) $media->getAttribute('variant_bytes'))->toBe(0)
            ->and((int) $media->getAttribute('original_bytes'))->toBe($original)
            ->and(app(MediaService::class)->bytesUsedBy($this->owner))->toBeGreaterThanOrEqual($original);
    });

    it('counts a failed upload for nothing', function () {
        $service = app(MediaService::class);
        $media = $service->reserve($this->owner, publishedVehicle($this->owner), [], 12345);

        expect($service->bytesUsedBy($this->owner))->toBe(12345);

        $service->markFailed($media);

        expect($service->bytesUsedBy($this->owner))->toBe(0)
            ->and($media->status)->toBe(MediaStatus::Failed);
    });

    it('holds an upload still in work against the allowance, so a burst cannot run past it', function () {
        $service = app(MediaService::class);
        $vehicle = publishedVehicle($this->owner);
        $service->reserve($this->owner, $vehicle, [], 2 * 1024 * 1024);

        expect(fn () => $service->reserve($this->owner, $vehicle, [], 1))->toThrow(ApiException::class);
    });

    it('removes the drafts and files of an account nobody verified after 7 days', function () {
        $member = User::factory()->unverified()->create();
        $draft = Vehicle::factory()->create(['owner_id' => $member->id]);
        $service = app(MediaService::class);
        $media = $service->storeFromUpload(hardeningUpload(), $member, $draft);
        $original = (string) $media->getAttribute('original_path');
        $member->forceFill(['created_at' => now()->subDays(8)])->save();

        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(User::withTrashed()->whereKey($member->id)->exists())->toBeFalse()
            ->and(Vehicle::withTrashed()->whereKey($draft->id)->exists())->toBeFalse()
            ->and(Media::withTrashed()->whereKey($media->id)->exists())->toBeFalse();

        Storage::disk('local')->assertMissing($original);
    });
});
