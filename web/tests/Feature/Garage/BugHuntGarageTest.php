<?php

use App\Actions\Garage\ReorderVehicles;
use App\Actions\Garage\SetMainVehicle;
use App\Models\Generation;
use App\Models\ModCategoryField;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Garage\ModPresenter;
use App\Services\Search\VehicleSearchProjector;
use Carbon\CarbonImmutable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

/**
 * The garage findings of the Phase 1 bug hunt (docs/reports/phase-1/bug-hunt.md).
 */
beforeEach(function () {
    Storage::fake('public');
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    $this->withHeader('Accept-Language', 'de');
});

describe('DQ-177: a bolt pattern reads the same whoever typed it', function () {
    it('is written the way the reader\'s language writes it, and anything else stays as typed', function (string $typed, string $de, string $en) {
        $field = ModCategoryField::query()->where('key', 'bolt_pattern')->firstOrFail();
        $mods = app(ModPresenter::class);

        expect($mods->fieldValue($field, $typed, 'de'))->toBe($de)
            ->and($mods->fieldValue($field, $typed, 'en'))->toBe($en);
    })->with([
        ['5x114.3', '5×114,3', '5×114.3'],
        ['5×114,3', '5×114,3', '5×114.3'],
        ['5 X 120', '5×120', '5×120'],
        ['4x100 / 4x114.3', '4x100 / 4x114.3', '4x100 / 4x114.3'],
        ['Mehrloch', 'Mehrloch', 'Mehrloch'],
    ]);

    it('leaves other text fields alone, even when they look the same', function () {
        $field = ModCategoryField::query()->where('key', 'tyre_size_front')->firstOrFail();

        expect(app(ModPresenter::class)->fieldValue($field, '5x114.3', 'de'))->toBe('5x114.3');
    });

    it('shows the written form on VEH-02 and keeps what the member typed for the editor', function () {
        $vehicle = publishedVehicle($this->owner);
        $mod = modIn($vehicle, 'wheels_tires', ['bolt_pattern' => '5x114.3'], ['title' => 'Volk TE37']);
        Sanctum::actingAs($this->owner);

        $data = $this->getJson("/api/v1/mods/{$mod->id}")->assertOk()->json('data');

        expect($data['fields']['bolt_pattern'])->toBe('5x114.3')
            ->and(collect($data['specs'])->firstWhere('key', 'bolt_pattern')['value'])->toBe('5×114,3');
    });
});

describe('BH-02 and BH-09: every client gets the reason as the message', function () {
    it('names the limit of vehicles in the message and keeps the errors key', function () {
        config(['speedclub.garage.max_vehicles_per_member' => 1]);
        Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $reason = (string) __('garage.limit_reached', ['max' => 1]);

        $this->postJson('/api/v1/vehicles')
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('message', $reason)
            ->assertJsonPath('errors.vehicle.0', $reason);
    });

    it('names the limit of modifications in the message and keeps the errors key', function () {
        config(['speedclub.garage.max_modifications_per_vehicle' => 1]);
        $vehicle = publishedVehicle($this->owner);
        modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $reason = (string) __('garage.mod_limit_reached', ['max' => 1]);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'Teil'])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('message', $reason)
            ->assertJsonPath('errors.modification.0', $reason);
    });

    it('names the wrong order of vehicles in the message and keeps the errors key', function () {
        publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $reason = (string) __('garage.order_mismatch');

        $this->putJson('/api/v1/me/vehicles/order', ['ids' => [(string) str()->ulid()]])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('message', $reason)
            ->assertJsonPath('errors.ids.0', $reason);
    });

    it('names the wrong order of modifications in the message and keeps the errors key', function () {
        $vehicle = publishedVehicle($this->owner);
        modIn($vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $reason = (string) __('garage.order_mismatch');

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/mods/order", ['ids' => [(string) str()->ulid()]])
            ->assertUnprocessable()
            ->assertJsonPath('message', $reason)
            ->assertJsonPath('errors.ids.0', $reason);
    });

    it('names the wrong order of photos in the message and keeps the errors key', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $reason = (string) __('media.order_mismatch');

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/media/order", ['ids' => [(string) str()->ulid()]])
            ->assertUnprocessable()
            ->assertJsonPath('message', $reason)
            ->assertJsonPath('errors.ids.0', $reason);
    });
});

describe('BH-05: attribute names of the garage forms in validation messages', function () {
    it('says Baujahr in German and model year in English', function () {
        Sanctum::actingAs($this->owner);
        $max = Carbon::now(config()->string('speedclub.display_timezone'))->year + 1;

        $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/vehicles', ['model_year' => 2099])
            ->assertUnprocessable()
            ->assertJsonPath('errors.model_year.0', "Baujahr darf maximal {$max} sein.");

        $this->withHeader('Accept-Language', 'en')->postJson('/api/v1/vehicles', ['model_year' => 2099])
            ->assertUnprocessable()
            ->assertJsonPath('errors.model_year.0', "The model year field must not be greater than {$max}.");
    });

    it('says what a spec field is called, in German', function (string $field, mixed $value, string $expected) {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->withHeader('Accept-Language', 'de')->putJson("/api/v1/vehicles/{$vehicle->id}/specs", [$field => $value, ...($field === 'power_value' ? ['power_unit' => 'ps'] : [])])
            ->assertUnprocessable()
            ->assertJsonPath("errors.{$field}.0", $expected);
    })->with([
        'displacement' => ['displacement_cc', 'viel', 'Hubraum muss eine ganze Zahl sein.'],
        'power' => ['power_value', -1, 'Leistung muss größer als 0 sein.'],
        'torque' => ['torque_nm', 'viel', 'Drehmoment muss eine ganze Zahl sein.'],
        'engine code' => ['engine_code', str_repeat('x', 41), 'Motorcode darf maximal 40 Zeichen haben.'],
    ]);

    it('reads as German on the fields a member can really get wrong on a modification', function (string $field, mixed $value, string $expected) {
        $mod = modIn(publishedVehicle($this->owner), 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->withHeader('Accept-Language', 'de')->patchJson("/api/v1/mods/{$mod->id}", [$field => $value])
            ->assertUnprocessable()
            ->assertJsonPath("errors.{$field}.0", $expected);
    })->with([
        'notes' => ['notes', str_repeat('x', 501), 'Notiz darf maximal 500 Zeichen haben.'],
        'cost' => ['cost_cents', -1, 'Kostenangabe muss mindestens 0 sein.'],
    ]);

    it('has a German name for every field of the vehicle, spec and modification forms', function () {
        $fields = [
            'make_id', 'model_id', 'generation_id', 'model_year', 'nickname', 'hu_au_due', 'wizard_step', 'cover_media_id',
            'engine_code', 'engine_text', 'displacement_cc', 'fuel', 'aspiration', 'power_value', 'power_unit', 'power_source', 'torque_nm', 'torque_source', 'drivetrain', 'gearbox',
            'brand_id', 'brand_text', 'part_name', 'part_number', 'installed_on', 'cost_cents', 'cost_public', 'legal_status', 'notes', 'note', 'visibility', 'fields', 'ids',
        ];

        foreach ($fields as $field) {
            expect(trans()->hasForLocale("validation.attributes.{$field}", 'de'))->toBeTrue($field);
        }
    });

    it('has an English name where the key alone would read as code', function () {
        foreach (['make_id', 'model_id', 'generation_id', 'model_year', 'hu_au_due', 'wizard_step', 'cover_media_id', 'engine_text', 'displacement_cc', 'power_value', 'power_unit', 'power_source', 'torque_nm', 'torque_source', 'brand_id', 'brand_text', 'part_name', 'installed_on', 'cost_cents', 'cost_public'] as $field) {
            expect(trans()->hasForLocale("validation.attributes.{$field}", 'en'))->toBeTrue($field);
        }
    });
});

describe('BH-07 and BH-48: dates compare in the display zone', function () {
    it('takes the month it is in Germany, in the first hours of a month too', function (string $moment, string $month) {
        $this->travelTo(CarbonImmutable::parse($moment, 'Europe/Berlin'));
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'Teil', 'installed_on' => $month])
            ->assertCreated()
            ->assertJsonPath('data.installed_on', $month)
            ->json('data.id');

        expect($this->patchJson("/api/v1/mods/{$id}", ['installed_on' => $month])->assertOk()->json('data.installed_on'))->toBe($month);
    })->with([
        'winter, UTC is still in November' => ['2026-12-01 00:30', '2026-12'],
        'summer, UTC is still in June' => ['2026-07-01 01:59', '2026-07'],
        'mid-month' => ['2026-12-15 12:00', '2026-12'],
    ]);

    it('refuses the month that has not begun in Germany', function (string $moment, string $month) {
        $this->travelTo(CarbonImmutable::parse($moment, 'Europe/Berlin'));
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'other', 'title' => 'Teil', 'installed_on' => $month])
            ->assertUnprocessable()
            ->assertJsonPath('errors.installed_on.0', __('garage.installed_in_future'));
    })->with([
        'half an hour before December' => ['2026-11-30 23:30', '2026-12'],
        'next month' => ['2026-12-15 12:00', '2027-01'],
    ]);

    it('counts the model year from the year it is in Germany, on New Year\'s Eve too', function () {
        Sanctum::actingAs($this->owner);

        // 23:30 in Berlin on 31 December: next year is 2027, so 2028 is out.
        $this->travelTo(CarbonImmutable::parse('2026-12-31 23:30', 'Europe/Berlin'));
        $this->postJson('/api/v1/vehicles', ['model_year' => 2028])->assertUnprocessable()->assertJsonValidationErrorFor('model_year');
        $this->postJson('/api/v1/vehicles', ['model_year' => 2027])->assertCreated();

        // 00:30 in Berlin on 1 January, still 2026 in UTC: next year is 2028.
        $this->travelTo(CarbonImmutable::parse('2027-01-01 00:30', 'Europe/Berlin'));
        $this->postJson('/api/v1/vehicles', ['model_year' => 2028])->assertCreated();
        $this->postJson('/api/v1/vehicles', ['model_year' => 2029])->assertUnprocessable()->assertJsonValidationErrorFor('model_year');
    });

    it('lets an open generation run to next year in Germany as well', function () {
        Sanctum::actingAs($this->owner);
        $model = VehicleModel::factory()->create();
        $generation = Generation::factory()->create(['model_id' => $model->id, 'year_from' => 2020, 'year_to' => null]);
        $this->travelTo(CarbonImmutable::parse('2027-01-01 00:30', 'Europe/Berlin'));

        $this->postJson('/api/v1/vehicles', ['make_id' => $model->make_id, 'model_id' => $model->id, 'generation_id' => $generation->id, 'model_year' => 2028])
            ->assertCreated();
    });
});

describe('BH-44: housekeeping does not count as a change of the build', function () {
    beforeEach(function () {
        $this->at = CarbonImmutable::parse('2026-01-15 10:00:00');
        $this->travelTo($this->at);
        $this->first = publishedVehicle($this->owner, ['is_main' => true, 'sort' => 0]);
        $this->second = publishedVehicle($this->owner, ['is_main' => false, 'sort' => 1]);
        $this->travelTo($this->at->addMonths(6));
        Sanctum::actingAs($this->owner);
    });

    it('leaves updated_at alone when the garage is sorted', function () {
        $this->putJson('/api/v1/me/vehicles/order', ['ids' => [$this->second->id, $this->first->id]])->assertOk();

        expect($this->first->fresh()->updated_at->equalTo($this->at))->toBeTrue()
            ->and($this->second->fresh()->updated_at->equalTo($this->at))->toBeTrue()
            ->and($this->second->fresh()->getAttribute('sort'))->toBe(0)
            ->and($this->first->fresh()->getAttribute('sort'))->toBe(1);
    });

    it('leaves updated_at alone when the main vehicle changes, on both vehicles', function () {
        $data = $this->postJson("/api/v1/vehicles/{$this->second->id}/main")->assertOk()->json('data');

        expect($data['is_main'])->toBeTrue()
            ->and($this->first->fresh()->is_main)->toBeFalse()
            ->and($this->second->fresh()->is_main)->toBeTrue()
            ->and($this->first->fresh()->updated_at->equalTo($this->at))->toBeTrue()
            ->and($this->second->fresh()->updated_at->equalTo($this->at))->toBeTrue();
    });

    it('hands the title to the next vehicle on delete without moving that one', function () {
        $this->deleteJson("/api/v1/vehicles/{$this->first->id}")->assertNoContent();

        expect($this->second->fresh()->is_main)->toBeTrue()
            ->and($this->second->fresh()->updated_at->equalTo($this->at))->toBeTrue();
    });

    it('keeps a build\'s place in Neue Builds through sorting, a new main vehicle and a later rebuild', function () {
        $stranger = publishedVehicle(User::factory()->create());
        $stranger->forceFill(['updated_at' => $this->at->addMonths(3)])->save();
        $search = app(VehicleSearchProjector::class);

        foreach ([$this->first, $this->second, $stranger] as $vehicle) {
            $search->rebuild($vehicle->id);
        }

        $order = fn (): array => collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->pluck('id')->all();
        $before = $order();

        expect($before[0])->toBe($stranger->id);

        app(ReorderVehicles::class)->handle($this->owner, [$this->second->id, $this->first->id]);
        app(SetMainVehicle::class)->handle($this->owner, $this->second);

        foreach ([$this->first, $this->second, $stranger] as $vehicle) {
            $search->rebuild($vehicle->id);
        }

        expect($order())->toBe($before);
    });
});

describe('BH-16: the server says whether Verlauf got an entry', function () {
    beforeEach(function () {
        $this->vehicle = publishedVehicle($this->owner);
        $this->mod = modIn($this->vehicle, 'exhaust', ['brand' => 'Akrapovic'], ['title' => 'Akrapovic']);
        Sanctum::actingAs($this->owner);
        $this->patch = fn (array $body) => $this->patchJson("/api/v1/mods/{$this->mod->id}", $body)->assertOk();
    });

    it('answers false for an edit only the owner reads', function (array $body) {
        ($this->patch)($body)->assertJsonPath('data.history_recorded', false);

        expect($this->vehicle->buildUpdates()->count())->toBe(0);
    })->with([
        'notes' => [['notes' => 'Nur für mich']],
        'private cost' => [['cost_cents' => 5000]],
        'month' => [['installed_on' => '2023-03']],
        'part number' => [['part_number' => 'X-1']],
    ]);

    it('answers true when the public face changed, and then Verlauf has the entry', function () {
        ($this->patch)(['fields' => ['brand' => 'Eisenmann']])->assertJsonPath('data.history_recorded', true);

        expect($this->vehicle->buildUpdates()->count())->toBe(1);
    });

    it('answers true again for a second change that joins the open entry', function () {
        ($this->patch)(['fields' => ['brand' => 'Eisenmann']])->assertJsonPath('data.history_recorded', true);
        ($this->patch)(['fields' => ['brand' => 'Remus']])->assertJsonPath('data.history_recorded', true);

        expect($this->vehicle->buildUpdates()->count())->toBe(1);
    });

    it('answers false for a value changed back in the window, which leaves nothing to show', function () {
        ($this->patch)(['fields' => ['brand' => 'Eisenmann']])->assertJsonPath('data.history_recorded', true);
        ($this->patch)(['fields' => ['brand' => 'Akrapovic']])->assertJsonPath('data.history_recorded', false);

        expect($this->vehicle->buildUpdates()->count())->toBe(0);
    });

    it('answers false on a draft, which has no history yet', function () {
        $draft = completeDraft($this->owner);
        $mod = modIn($draft, 'exhaust', ['brand' => 'Akrapovic'], ['title' => 'Akrapovic']);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['fields' => ['brand' => 'Eisenmann']])
            ->assertOk()
            ->assertJsonPath('data.history_recorded', false);
    });

    it('does not put the field on create or read', function () {
        $data = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'other', 'title' => 'Teil'])->assertCreated()->json('data');

        expect($data)->not->toHaveKey('history_recorded')
            ->and($this->getJson("/api/v1/mods/{$this->mod->id}")->assertOk()->json('data'))->not->toHaveKey('history_recorded');
    });

    describe('on PUT specs, which can record nothing as well', function () {
        it('answers true for a change and false for the same values again', function () {
            $url = "/api/v1/vehicles/{$this->vehicle->id}/specs";

            $this->putJson($url, ['torque_nm' => 500])->assertOk()->assertJsonPath('data.history_recorded', true);
            $this->putJson($url, ['torque_nm' => 500])->assertOk()->assertJsonPath('data.history_recorded', false);
        });

        it('answers false for what Verlauf does not tell: the same power in another unit, a source of the torque', function () {
            $url = "/api/v1/vehicles/{$this->vehicle->id}/specs";

            $this->putJson($url, ['torque_nm' => 500, 'power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'factory'])->assertOk()->assertJsonPath('data.history_recorded', true);
            $this->travel(1)->hours();

            $this->putJson($url, ['torque_nm' => 500, 'torque_source' => 'measured', 'power_value' => 510, 'power_unit' => 'ps', 'power_source' => 'factory'])->assertOk()->assertJsonPath('data.history_recorded', false);
            $this->putJson($url, ['torque_nm' => 500, 'torque_source' => 'measured', 'power_value' => 375, 'power_unit' => 'kw', 'power_source' => 'factory'])->assertOk()->assertJsonPath('data.history_recorded', false);
        });

        it('answers false on a draft', function () {
            $draft = completeDraft($this->owner);

            $this->putJson("/api/v1/vehicles/{$draft->id}/specs", ['torque_nm' => 500])->assertOk()->assertJsonPath('data.history_recorded', false);
        });

        it('answers false for a value changed back in the window', function () {
            $url = "/api/v1/vehicles/{$this->vehicle->id}/specs";

            $this->putJson($url, ['torque_nm' => 500])->assertOk()->assertJsonPath('data.history_recorded', true);
            $this->putJson($url, [])->assertOk()->assertJsonPath('data.history_recorded', false);
        });
    });
});
