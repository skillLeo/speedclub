<?php

use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Brand;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\RebuildVehicleSearch;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/GarageTestHelpers.php';

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->owner = User::factory()->create();
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
});

/**
 * @return array<string, mixed>
 */
function wheelFields(array $overrides = []): array
{
    return [
        'wheel_brand' => 'BBS',
        'wheel_model' => 'LM',
        'diameter' => 19,
        'width_front' => 9.5,
        'width_rear' => 9.5,
        'et_front' => 35,
        'et_rear' => 35,
        'bolt_pattern' => '5x120',
        'staggered' => false,
        'tyre_size_front' => '255/35 R19',
        'tyre_size_rear' => '255/35 R19',
        ...$overrides,
    ];
}

describe('POST vehicles/{id}/mods', function () {
    it('creates a wheels mod: title from brand and model, the line of FS-6, private cost', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->withHeader('Accept-Language', 'de')->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", [
            'category' => 'wheels_tires',
            'status' => 'installed',
            'installed_on' => '2023-03',
            'cost_cents' => 420000,
            'notes' => 'Bündig mit ET35.',
            'fields' => wheelFields(),
        ])->assertCreated()
            ->assertJsonPath('data.title', 'BBS LM')
            ->assertJsonPath('data.brand', 'BBS')
            ->assertJsonPath('data.summary_line', "BBS LM · 19\u{2033} \u{00D7} 9,5J ET35 · 255/35 R19")
            ->assertJsonPath('data.status_label', 'Verbaut')
            ->assertJsonPath('data.installed_on', '2023-03')
            ->assertJsonPath('data.installed_label', 'März 2023')
            ->assertJsonPath('data.cost_public', false)
            ->assertJsonPath('data.cost.cents', 420000)
            ->assertJsonPath('data.cost.label', '4.200 €')
            ->assertJsonPath('data.category.key', 'wheels_tires')
            ->assertJsonPath('data.fields.diameter', 19);

        expect($response->json('data.specs'))->toContain(['key' => 'width_front', 'label' => 'Breite vorne', 'value' => '9,5J'])
            ->and($response->json('data.specs'))->toContain(['key' => 'et_front', 'label' => 'ET vorne', 'value' => 'ET35'])
            ->and($response->json('data.specs'))->toContain(['key' => 'staggered', 'label' => 'Mischbereifung', 'value' => 'Nein']);

        expect(Modification::query()->findOrFail($response->json('data.id'))->brand_id)->toBe(Brand::query()->where('name', 'BBS')->value('id'));
    });

    it('keeps a title the member wrote, also after later edits', function () {
        Sanctum::actingAs($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'title' => 'Meine Felgen', 'fields' => wheelFields()])
            ->assertCreated()->assertJsonPath('data.title', 'Meine Felgen')->json('data.id');

        $this->patchJson("/api/v1/mods/$id", ['fields' => wheelFields(['wheel_model' => 'FI-R'])])->assertOk()->assertJsonPath('data.title', 'Meine Felgen');
    });

    it('lets an automatic title follow brand and model', function () {
        Sanctum::actingAs($this->owner);

        $id = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => wheelFields()])->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/mods/$id", ['fields' => wheelFields(['wheel_model' => 'FI-R'])])->assertOk()->assertJsonPath('data.title', 'BBS FI-R');
    });

    it('takes a brand from the catalogue, or free text', function () {
        Sanctum::actingAs($this->owner);
        $kw = Brand::query()->where('name', 'KW')->firstOrFail();

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'brand_id' => $kw->id, 'part_name' => 'V3', 'fields' => ['type' => 'coilover', 'lowering_front' => 35]])
            ->assertCreated()
            ->assertJsonPath('data.title', 'KW V3')
            ->assertJsonPath('data.brand_id', $kw->id)
            ->assertJsonPath('data.summary_line', "KW V3 · \u{2212}35 mm");

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'suspension', 'brand_text' => 'Eigenbau GmbH', 'part_name' => 'Spezial', 'fields' => ['type' => 'other']])
            ->assertCreated()
            ->assertJsonPath('data.title', 'Eigenbau GmbH Spezial')
            ->assertJsonPath('data.brand', 'Eigenbau GmbH')
            ->assertJsonPath('data.brand_id', null);
    });

    it('accepts the rear diameter of ADR-112 only where it differs and with a front', function () {
        Sanctum::actingAs($this->owner);

        $different = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => wheelFields(['diameter' => 20, 'diameter_rear' => 21])])
            ->assertCreated()->assertJsonPath('data.fields.diameter_rear', 21);

        expect($different->json('data.summary_line'))->toContain("20/21\u{2033}");

        $same = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => wheelFields(['diameter' => 19, 'diameter_rear' => 19])])->assertCreated();

        expect($same->json('data.fields'))->not->toHaveKey('diameter_rear');

        $fields = wheelFields(['diameter_rear' => 21]);
        unset($fields['diameter']);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'wheels_tires', 'fields' => $fields])
            ->assertUnprocessable()->assertJsonValidationErrorFor('fields.diameter_rear');
    });

    it('checks the fields against the schema of the category', function (string $category, array $fields, string $key) {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => $category, 'fields' => $fields])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrorFor("fields.$key");

        expect(Modification::query()->count())->toBe(0);
    })->with([
        'unknown key' => ['wheels_tires', ['horsepower' => 3], 'horsepower'],
        'key of another category' => ['suspension', ['diameter' => 19], 'diameter'],
        'unit as a key of its own' => ['wheels_tires', ['diameter_unit' => 'cm'], 'diameter_unit'],
        'number as text' => ['wheels_tires', ['diameter' => '19'], 'diameter'],
        'number in a wrong unit' => ['wheels_tires', ['diameter' => '19 cm'], 'diameter'],
        'number with its own unit' => ['wheels_tires', ['diameter' => ['value' => 48, 'unit' => 'cm']], 'diameter'],
        'centimetres out of range' => ['wheels_tires', ['diameter' => 48], 'diameter'],
        'below the minimum' => ['wheels_tires', ['diameter' => 12], 'diameter'],
        'above the maximum' => ['wheels_tires', ['diameter' => 25], 'diameter'],
        'off the step' => ['wheels_tires', ['diameter' => 19.3], 'diameter'],
        'rear off the step' => ['wheels_tires', ['diameter' => 19, 'diameter_rear' => 20.25], 'diameter_rear'],
        'width off the step' => ['wheels_tires', ['width_front' => 9.25], 'width_front'],
        'offset below the minimum' => ['wheels_tires', ['et_front' => -51], 'et_front'],
        'offset above the maximum' => ['wheels_tires', ['et_rear' => 71], 'et_rear'],
        'spacer negative' => ['wheels_tires', ['spacer_front' => -5], 'spacer_front'],
        'boolean as a word' => ['wheels_tires', ['staggered' => 'ja'], 'staggered'],
        'boolean as a number' => ['suspension', ['adjustable_damping' => 1], 'adjustable_damping'],
        'text as a number' => ['wheels_tires', ['finish' => 5], 'finish'],
        'text too long' => ['wheels_tires', ['finish' => str_repeat('x', 161)], 'finish'],
        'tyre size without the space' => ['wheels_tires', ['tyre_size_front' => '255/35R19'], 'tyre_size_front'],
        'tyre size with a line break' => ['wheels_tires', ['tyre_size_rear' => "255/35 R19\nx"], 'tyre_size_rear'],
        'option not in the list' => ['suspension', ['type' => 'magic'], 'type'],
        'option as a label' => ['suspension', ['type' => 'Gewindefahrwerk'], 'type'],
        'brand as a number' => ['suspension', ['brand' => 7], 'brand'],
        'lowering out of range' => ['suspension', ['lowering_front' => 500], 'lowering_front'],
        'pistons off the step' => ['brakes', ['front_pistons' => 4.5], 'front_pistons'],
        'required title missing' => ['other', [], 'title'],
    ]);

    it('takes the other category with its required title, also as the common field', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'other', 'title' => 'Dachbox'])
            ->assertCreated()->assertJsonPath('data.title', 'Dachbox')->assertJsonPath('data.fields.title', 'Dachbox');
    });

    it('refuses fields that are a list, and every common field out of bounds', function (array $body, string $field) {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', ...$body])->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'list of fields' => [['fields' => ['catback']], 'fields'],
        'status unknown' => [['status' => 'gone'], 'status'],
        'month as a date' => [['installed_on' => '2023-03-01'], 'installed_on'],
        'month in the future' => [['installed_on' => '2099-01'], 'installed_on'],
        'cost negative' => [['cost_cents' => -1], 'cost_cents'],
        'cost as text' => [['cost_cents' => 'viel'], 'cost_cents'],
        'notes too long' => [['notes' => str_repeat('x', 501)], 'notes'],
        'title too long' => [['title' => str_repeat('x', 161)], 'title'],
        'brand unknown' => [['brand_id' => 999999], 'brand_id'],
        'legal status unknown' => [['legal_status' => 'egal'], 'legal_status'],
    ]);

    it('needs a known category', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['fields' => []])->assertUnprocessable()->assertJsonValidationErrorFor('category');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'rockets', 'fields' => []])->assertUnprocessable()->assertJsonValidationErrorFor('category');
    });

    it('drops the installed month of a planned part', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'status' => 'planned', 'installed_on' => '2023-03', 'fields' => ['type' => 'catback']])
            ->assertCreated()->assertJsonPath('data.installed_on', null);
    });

    it('stores a legal status only while its flag is on', function () {
        Sanctum::actingAs($this->owner);
        $body = ['category' => 'exhaust', 'legal_status' => 'abe', 'fields' => ['type' => 'catback']];

        $off = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", $body)->assertCreated()->assertJsonPath('data.legal_status', null)->assertJsonPath('data.legal_disclaimer', null);

        expect(Modification::query()->findOrFail($off->json('data.id'))->legal_status->value)->toBe('unknown');

        FeatureFlag::query()->create(['key' => 'sig.mod_legal_status', 'enabled' => true]);

        $this->withHeader('Accept-Language', 'de')->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", $body)->assertCreated()
            ->assertJsonPath('data.legal_status', 'abe')
            ->assertJsonPath('data.legal_status_label', 'ABE')
            ->assertJsonPath('data.legal_disclaimer', 'Angaben des Besitzers, keine rechtliche Prüfung');
    });

    it('stops at the limit per vehicle', function () {
        config(['speedclub.garage.max_modifications_per_vehicle' => 1]);
        modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])
            ->assertUnprocessable()->assertJsonValidationErrorFor('modification');
    });

    it('replays with the same Idempotency-Key', function () {
        Sanctum::actingAs($this->owner);
        $body = ['category' => 'exhaust', 'fields' => ['type' => 'catback']];

        $first = $this->withHeader('Idempotency-Key', 'mod-1')->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", $body)->assertCreated();
        $second = $this->withHeader('Idempotency-Key', 'mod-1')->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($second->json('data.id'))->toBe($first->json('data.id'))
            ->and(Modification::query()->count())->toBe(1);
    });

    it('is rate limited', function () {
        config(['speedclub.rate_limits.garage_writes.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertTooManyRequests();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertStatus($status);
    })->with(ownerOnlyMatrix(201));

    it('refuses a publishing restriction and a suspension', function (Closure $state) {
        $member = $state();
        $vehicle = Vehicle::factory()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    })->with([
        'restricted' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
    ]);
});

describe('GET vehicles/{id}/mods and mods/{id}', function () {
    it('lists in the order of the member, cost only for the owner', function () {
        $second = modIn($this->vehicle, 'exhaust', [], ['sort' => 2, 'title' => 'Zwei', 'cost_cents' => 100]);
        $first = modIn($this->vehicle, 'brakes', [], ['sort' => 1, 'title' => 'Eins', 'cost_cents' => 100]);
        Sanctum::actingAs($this->owner);

        $response = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$first->id, $second->id])
            ->and($response->json('data.0.cost.cents'))->toBe(100)
            ->and($response->json('data.0.fields'))->not->toBeNull();

        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()
            ->assertJsonPath('data.0.cost', null)
            ->assertJsonPath('data.0.fields', null);
    });

    it('does not exist for those who may not see the vehicle', function () {
        $private = Vehicle::factory()->private()->create(['owner_id' => $this->owner->id]);
        $mod = modIn($private, 'exhaust');
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$private->id}/mods")->assertNotFound();
        $this->getJson("/api/v1/mods/{$mod->id}")->assertNotFound();
    });

    it('needs a sign-in', function () {
        $mod = modIn($this->vehicle, 'exhaust');

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertUnauthorized();
        $this->getJson("/api/v1/mods/{$mod->id}")->assertUnauthorized();
    });
});

describe('PATCH mods/{id}', function () {
    it('changes only what was sent, the category not at all', function () {
        $mod = modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['notes' => 'Alt', 'cost_cents' => 500]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['notes' => 'Neu'])->assertOk()
            ->assertJsonPath('data.notes', 'Neu')
            ->assertJsonPath('data.cost.cents', 500)
            ->assertJsonPath('data.fields.type', 'catback');

        $this->patchJson("/api/v1/mods/{$mod->id}", ['category' => 'brakes'])->assertUnprocessable()->assertJsonValidationErrorFor('category');
    });

    it('checks fields against the category it has', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$mod->id}", ['fields' => ['diameter' => 19]])->assertUnprocessable()->assertJsonValidationErrorFor('fields.diameter');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $mod = modIn($this->vehicle, 'exhaust');
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->patchJson("/api/v1/mods/{$mod->id}", ['notes' => 'x'])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));
});

describe('DELETE mods/{id}', function () {
    it('deletes softly with its photos and stays open under a restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);
        $mod = modIn($vehicle, 'exhaust');
        $photo = Media::factory()->forModel($mod)->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->deleteJson("/api/v1/mods/{$mod->id}")->assertNoContent();

        expect(Modification::withTrashed()->findOrFail($mod->id)->trashed())->toBeTrue()
            ->and(Media::withTrashed()->findOrFail($photo->id)->trashed())->toBeTrue();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $mod = modIn($this->vehicle, 'exhaust');
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->deleteJson("/api/v1/mods/{$mod->id}")->assertStatus($status);
    })->with(ownerOnlyMatrix(204));
});

describe('PUT vehicles/{id}/mods/order', function () {
    it('takes every modification exactly once', function () {
        $a = modIn($this->vehicle, 'exhaust', [], ['sort' => 1]);
        $b = modIn($this->vehicle, 'brakes', [], ['sort' => 2]);
        Sanctum::actingAs($this->owner);

        $response = $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$b->id, $a->id]])->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$b->id, $a->id]);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$a->id]])->assertUnprocessable()->assertJsonValidationErrorFor('ids');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $mod = modIn($this->vehicle, 'exhaust');
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/mods/order", ['ids' => [$mod->id]])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));
});

describe('POST mods/{id}/media', function () {
    it('goes through the pipeline, never becomes the cover, and stops at 6', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);
        $photo = fn () => ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(800, 600))];

        $this->post("/api/v1/mods/{$mod->id}/media", $photo(), ['Accept' => 'application/json'])->assertCreated()
            ->assertJsonPath('data.status', 'ready');

        expect($this->vehicle->refresh()->cover_media_id)->toBeNull();

        Media::factory()->forModel($mod)->count(5)->create(['owner_id' => $this->owner->id]);

        $this->post("/api/v1/mods/{$mod->id}/media", $photo(), ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrorFor('file');
    });

    it('refuses what is no photo', function () {
        $mod = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', '<?php echo 1;')], ['Accept' => 'application/json'])->assertStatus(415);
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $mod = modIn($this->vehicle, 'exhaust');
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->post("/api/v1/mods/{$mod->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])->assertStatus($status);
    })->with(ownerOnlyMatrix(201));
});

it('queues the search rebuild after a change of a published vehicle', function () {
    Sanctum::actingAs($this->owner);
    Queue::fake();

    $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'fields' => []])->assertCreated();

    Queue::assertPushed(RebuildVehicleSearch::class, 1);
});
