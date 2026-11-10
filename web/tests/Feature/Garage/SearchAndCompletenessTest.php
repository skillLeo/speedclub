<?php

use App\Enums\MediaStatus;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\Brand;
use App\Models\Make;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Services\Garage\VehicleCompleteness;
use App\Services\Search\RebuildVehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create();
    $this->projector = app(VehicleSearchProjector::class);
});

describe('vehicle_search', function () {
    it('holds the fields of 05_ARCHITECTURE §6', function () {
        $make = Make::factory()->create(['name' => 'Nissan']);
        $model = VehicleModel::factory()->create(['make_id' => $make->id, 'name' => 'Skyline GT-R']);
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'make_id' => $make->id, 'model_id' => $model->id, 'generation_id' => null, 'model_year' => 2002, 'nickname' => 'Bayside', 'description' => 'Aus Japan importiert']);

        $specs = new VehicleSpec(['vehicle_id' => $vehicle->id, 'engine_code' => 'RB26DETT', 'drivetrain' => 'all', 'gearbox' => 'manual', 'fuel' => 'petrol']);
        $specs->setPower(375, PowerUnit::Kw, PowerSource::Measured)->save();

        $rays = Brand::query()->where('name', 'Rays')->firstOrFail();
        $kw = Brand::query()->where('name', 'KW')->firstOrFail();
        $hks = Brand::query()->where('name', 'HKS')->firstOrFail();

        modIn($vehicle, 'wheels_tires', ['diameter' => 18, 'wheel_model' => 'TE37 Saga', 'tyre_model' => 'Pilot Sport'], ['title' => 'Rays TE37', 'brand_id' => $rays->id, 'notes' => 'Geheimer Hinweis', 'cost_cents' => 999]);
        modIn($vehicle, 'suspension', ['type' => 'coilover'], ['title' => 'KW V3', 'brand_id' => $kw->id]);
        modIn($vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'HKS Super', 'brand_id' => $hks->id]);
        modIn($vehicle, 'brakes', [], ['title' => 'Planned Brake', 'status' => 'planned']);
        modIn($vehicle, 'interior', [], ['title' => 'Removed Seat', 'status' => 'removed']);

        $this->projector->rebuild($vehicle->id);

        $row = VehicleSearch::query()->findOrFail($vehicle->id);

        expect($row->owner_id)->toBe($this->owner->id)
            ->and($row->make_id)->toBe($make->id)
            ->and($row->model_id)->toBe($model->id)
            ->and($row->model_year)->toBe(2002)
            ->and($row->power_ps)->toBe(509.86)
            ->and($row->drivetrain->value)->toBe('all')
            ->and($row->gearbox->value)->toBe('manual')
            ->and($row->fuel->value)->toBe('petrol')
            ->and($row->wheel_diameter)->toBe(18.0)
            ->and($row->wheel_brand_id)->toBe($rays->id)
            ->and($row->suspension_type)->toBe('coilover')
            ->and($row->suspension_brand_id)->toBe($kw->id)
            ->and($row->exhaust_brand_id)->toBe($hks->id)
            // wheels_tires = 1, suspension = 2, exhaust = 3: planned and removed do not count.
            ->and($row->mod_category_mask)->toBe(0b111)
            ->and($row->is_public)->toBeTrue()
            ->and($row->published_at)->not->toBeNull()
            ->and($row->search_text)->toContain('Nissan', 'Skyline GT-R', 'Bayside', 'Aus Japan', 'RB26DETT', 'Rays TE37', 'KW V3', 'HKS', 'TE37 Saga', 'Pilot Sport')
            ->and($row->search_text)->not->toContain('Geheimer Hinweis')
            ->and($row->search_text)->not->toContain('Planned Brake');
    });

    it('is idempotent and keeps the rank score', function () {
        $vehicle = publishedVehicle($this->owner);
        $this->projector->rebuild($vehicle->id);
        VehicleSearch::query()->whereKey($vehicle->id)->update(['rank_score' => 7.5]);

        $this->projector->rebuild($vehicle->id);
        $this->projector->rebuild($vehicle->id);

        expect(VehicleSearch::query()->where('vehicle_id', $vehicle->id)->count())->toBe(1)
            ->and(VehicleSearch::query()->findOrFail($vehicle->id)->rank_score)->toBe(7.5);
    });

    it('has no row for a draft or an archived or deleted vehicle', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $archived = Vehicle::factory()->archived()->create(['owner_id' => $this->owner->id]);
        $deleted = publishedVehicle($this->owner);
        $this->projector->rebuild($deleted->id);
        $deleted->delete();

        foreach ([$draft, $archived, $deleted] as $vehicle) {
            $this->projector->rebuild($vehicle->id);

            expect(VehicleSearch::query()->find($vehicle->id))->toBeNull();
        }
    });

    it('is not public while the vehicle or its owner is not', function (Closure $vehicle) {
        $target = $vehicle($this->owner);

        $this->projector->rebuild($target->id);

        expect(VehicleSearch::query()->findOrFail($target->id)->is_public)->toBeFalse();
    })->with([
        'unlisted' => [fn (User $o) => publishedVehicle($o, ['visibility' => 'unlisted'])],
        'private' => [fn (User $o) => publishedVehicle($o, ['visibility' => 'private'])],
        'suspended owner' => [fn () => publishedVehicle(User::factory()->suspended()->create())],
        'unverified owner' => [fn () => publishedVehicle(User::factory()->unverified()->create())],
    ]);

    it('is dispatched after the commit, and a job only rebuilds', function () {
        Queue::fake();
        Storage::fake('public');
        Storage::fake('local');
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['notes' => 'x'])->assertOk();
        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['torque_nm' => 500])->assertOk();

        // One job for the burst, not one per edit: it reads the rows when it runs.
        Queue::assertPushed(RebuildVehicleSearch::class, 1);

        (new RebuildVehicleSearch($vehicle->id))->handle($this->projector);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->vehicle_id)->toBe($vehicle->id);
    });

    it('rebuilds everything from the command and removes what should not be there', function () {
        $a = publishedVehicle($this->owner);
        $b = publishedVehicle($this->owner);
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        VehicleSearch::factory()->create(['vehicle_id' => $draft->id, 'owner_id' => $this->owner->id]);

        $this->artisan('search:rebuild')->assertSuccessful()->expectsOutputToContain('2');

        expect(VehicleSearch::query()->pluck('vehicle_id')->sort()->values()->all())->toBe(collect([$a->id, $b->id])->sort()->values()->all());
    });

    it('follows a mod that was added, in the mask and the text', function () {
        Storage::fake('public');
        Storage::fake('local');
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'suspension', 'brand_text' => 'KW', 'part_name' => 'V3', 'fields' => ['type' => 'coilover']])->assertCreated();

        $row = VehicleSearch::query()->findOrFail($vehicle->id);

        expect($row->suspension_type)->toBe('coilover')->and($row->mod_category_mask)->toBe(0b10)->and($row->search_text)->toContain('KW V3');
    });
});

describe('completeness', function () {
    it('counts what is there', function () {
        $empty = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'model_year' => null]);

        $result = app(VehicleCompleteness::class)->for($empty->load('media', 'specs'), 'de');

        expect($result['percent'])->toBe(0)
            ->and($result['is_complete'])->toBeFalse()
            ->and($result['missing'])->toHaveCount(13)
            ->and($result['hint'])->toBe('Noch 13 Angaben bis zum vollständigen Build')
            ->and($result['line'])->toBe('Build zu 0 % vollständig')
            ->and($result['missing'][0])->toBe(['key' => 'make', 'label' => 'Marke', 'section' => 'basics']);
    });

    it('says when it is done, and words one missing item', function () {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'color' => 'Blau', 'description' => 'Schön']);
        $specs = new VehicleSpec(['vehicle_id' => $vehicle->id, 'engine_text' => 'R6', 'torque_nm' => 500, 'drivetrain' => 'all', 'gearbox' => 'manual']);
        $specs->setPower(500, PowerUnit::Ps, PowerSource::Factory)->save();
        Media::factory()->forModel($vehicle)->count(3)->create(['owner_id' => $this->owner->id]);

        $oneLeft = app(VehicleCompleteness::class)->for($vehicle->load('media', 'specs'), 'de');

        expect($oneLeft['hint'])->toBe('Noch eine Angabe bis zum vollständigen Build')
            ->and($oneLeft['percent'])->toBe(92)
            ->and(array_column($oneLeft['missing'], 'key'))->toBe(['mod']);

        modIn($vehicle, 'exhaust');

        $done = app(VehicleCompleteness::class)->for($vehicle->fresh(['media', 'specs']), 'en');

        expect($done['percent'])->toBe(100)
            ->and($done['is_complete'])->toBeTrue()
            ->and($done['hint'])->toBeNull()
            ->and($done['missing'])->toBe([]);
    });

    it('does not count a photo that is not finished', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing]);

        $keys = array_column(app(VehicleCompleteness::class)->for($vehicle->load('media', 'specs'), 'de')['missing'], 'key');

        expect($keys)->toContain('photo', 'photos');
    });

    it('is the owner\'s alone', function () {
        Storage::fake('public');
        $vehicle = publishedVehicle($this->owner);

        $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk()->assertJsonPath('data.completeness', null);

        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertOk()->assertJsonPath('data.completeness', null);

        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertOk()->assertJsonStructure(['data' => ['completeness' => ['percent', 'is_complete', 'line', 'hint', 'missing']]]);
    });
});

describe('demo data', function () {
    it('has the draft at step 2 and real build updates', function () {
        config(['speedclub.demo.member_password' => 'demo-member-password', 'speedclub.demo.photo_limit' => 0]);
        $this->seed(DemoSeeder::class);

        $draft = Vehicle::query()->where('status', 'draft')->firstOrFail();

        expect($draft->wizard_step)->toBe(2)
            ->and(Vehicle::query()->where('status', 'published')->whereNotNull('wizard_step')->count())->toBe(0);

        $r34 = Vehicle::query()->where('public_id', DemoSeeder::publicIdFor('nissan-r34'))->firstOrFail();

        $page = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/public/vehicles/'.$r34->slug)->assertOk();

        expect(collect($page->json('data.updates'))->pluck('summary'))->toContain("Fahrwerk: Serie \u{2192} KW V3 · \u{2212}35 mm")
            ->and($page->json('data.mods.count'))->toBe(14)
            ->and($page->json('data.highlights.*.category.key'))->toBe(['wheels_tires', 'suspension', 'exhaust']);
    });
});
