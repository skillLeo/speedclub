<?php

use App\Enums\MediaStatus;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Http\RateLimits;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Services\Qr\QrCodes;
use App\Services\Search\RebuildVehicleSearch;
use App\Services\Search\VehicleSearchProjector;
use App\Support\Codes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    $this->owner = User::factory()->create();
});

describe('POST vehicles', function () {
    it('creates an empty draft at step 1', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->postJson('/api/v1/vehicles')->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.visibility', 'public')
            ->assertJsonPath('data.is_main', false)
            ->assertJsonPath('data.wizard', ['step' => 1, 'total_steps' => 4])
            ->assertJsonPath('data.completeness.percent', 0)
            ->assertJsonPath('data.qr', null);

        expect(Codes::isValid($response->json('data.public_id')))->toBeTrue()
            ->and($response->json('data.slug'))->toBe(strtolower($response->json('data.public_id')))
            ->and($this->owner->vehicles()->count())->toBe(1);
    });

    it('takes the first wizard step along', function () {
        Sanctum::actingAs($this->owner);
        $make = Make::factory()->create(['name' => 'Nissan']);
        $model = VehicleModel::factory()->create(['make_id' => $make->id, 'name' => 'Skyline GT-R']);
        $generation = Generation::factory()->create(['model_id' => $model->id, 'name' => 'R34', 'year_from' => 1999, 'year_to' => 2002]);

        $response = $this->postJson('/api/v1/vehicles', ['make_id' => $make->id, 'model_id' => $model->id, 'generation_id' => $generation->id, 'model_year' => 2002, 'wizard_step' => 2])
            ->assertCreated()
            ->assertJsonPath('data.eyebrow', 'NISSAN')
            ->assertJsonPath('data.title', 'Skyline GT-R R34')
            ->assertJsonPath('data.full_title', 'Nissan Skyline GT-R R34')
            ->assertJsonPath('data.wizard.step', 2);

        expect($response->json('data.slug'))->toBe('nissan-skyline-gt-r-r34-'.strtolower($response->json('data.public_id')));
    });

    it('files a catalogue request for a free-text make and model, once per wording', function () {
        Sanctum::actingAs($this->owner);

        $id = $this->postJson('/api/v1/vehicles', ['make_text' => 'Lada', 'model_text' => 'Niva'])
            ->assertCreated()
            ->assertJsonPath('data.make', 'Lada')
            ->assertJsonPath('data.model', 'Niva')
            ->json('data.id');

        $this->patchJson("/api/v1/vehicles/$id", ['make_text' => 'Lada', 'model_text' => 'Niva'])->assertOk();

        expect(CatalogRequest::query()->where('vehicle_id', $id)->count())->toBe(1)
            ->and(CatalogRequest::query()->where('vehicle_id', $id)->first()->make_text)->toBe('Lada')
            ->and(CatalogRequest::query()->where('vehicle_id', $id)->first()->user_id)->toBe($this->owner->id);

        $this->patchJson("/api/v1/vehicles/$id", ['model_text' => '4x4'])->assertOk();

        expect(CatalogRequest::query()->where('vehicle_id', $id)->count())->toBe(2);
    });

    it('stops at the configured limit, drafts included', function () {
        config(['speedclub.garage.max_vehicles_per_member' => 2]);
        Vehicle::factory()->count(2)->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles')->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrorFor('vehicle');
    });

    it('validates its fields', function (array $body, string $field) {
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles', $body)->assertUnprocessable()->assertJsonValidationErrorFor($field);

        expect($this->owner->vehicles()->count())->toBe(0);
    })->with([
        'make that does not exist' => [['make_id' => 999999], 'make_id'],
        'make id and text' => [fn () => ['make_id' => Make::factory()->create()->id, 'make_text' => 'Lada'], 'make_text'],
        'year too old' => [['model_year' => 1800], 'model_year'],
        'year in the far future' => [['model_year' => 2999], 'model_year'],
        'description too long' => [['description' => str_repeat('x', 501)], 'description'],
        'nickname too long' => [['nickname' => str_repeat('x', 61)], 'nickname'],
        'wizard step out of range' => [['wizard_step' => 5], 'wizard_step'],
        'inspection month as a date' => [['hu_au_due' => '2027-05-01'], 'hu_au_due'],
    ]);

    it('refuses a model of another make and a generation of another model', function () {
        Sanctum::actingAs($this->owner);
        $make = Make::factory()->create();
        $foreignModel = VehicleModel::factory()->create();
        $model = VehicleModel::factory()->create(['make_id' => $make->id]);
        $foreignGeneration = Generation::factory()->create();

        $this->postJson('/api/v1/vehicles', ['make_id' => $make->id, 'model_id' => $foreignModel->id])
            ->assertUnprocessable()->assertJsonValidationErrorFor('model_id');

        $this->postJson('/api/v1/vehicles', ['make_id' => $make->id, 'model_id' => $model->id, 'generation_id' => $foreignGeneration->id])
            ->assertUnprocessable()->assertJsonValidationErrorFor('generation_id');
    });

    it('refuses a model year outside the generation', function () {
        Sanctum::actingAs($this->owner);
        $generation = Generation::factory()->create(['year_from' => 1999, 'year_to' => 2002]);
        $model = VehicleModel::query()->findOrFail($generation->model_id);

        $this->postJson('/api/v1/vehicles', ['make_id' => $model->make_id, 'model_id' => $model->id, 'generation_id' => $generation->id, 'model_year' => 2010])
            ->assertUnprocessable()->assertJsonValidationErrorFor('model_year');
    });

    it('replays with the same Idempotency-Key', function () {
        Sanctum::actingAs($this->owner);

        $first = $this->withHeader('Idempotency-Key', 'draft-1')->postJson('/api/v1/vehicles')->assertCreated();
        $second = $this->withHeader('Idempotency-Key', 'draft-1')->postJson('/api/v1/vehicles')->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        expect($second->json('data.id'))->toBe($first->json('data.id'))
            ->and($this->owner->vehicles()->count())->toBe(1);
    });

    it('is rate limited per member', function () {
        config(['speedclub.rate_limits.garage_writes.max' => 2]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles')->assertCreated();
        $this->postJson('/api/v1/vehicles')->assertCreated();
        $this->postJson('/api/v1/vehicles')->assertTooManyRequests()->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    });

    it('allows drafts before verification and refuses a publishing restriction, a suspension and a guest', function () {
        Sanctum::actingAs(User::factory()->unverified()->create());
        $this->postJson('/api/v1/vehicles')->assertCreated();

        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
        $this->postJson('/api/v1/vehicles')->assertForbidden()->assertJsonPath('code', 'account_restricted');

        Sanctum::actingAs(User::factory()->suspended()->create());
        $this->postJson('/api/v1/vehicles')->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });

    it('refuses a guest and a staff session', function () {
        $this->postJson('/api/v1/vehicles')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');

        $this->actingAs(Staff::factory()->create(), 'staff');

        $this->postJson('/api/v1/vehicles')->assertUnauthorized();
    });
});

describe('GET me/vehicles', function () {
    it('lists main first, then in order, drafts with their step and everything with completeness', function () {
        $second = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $main = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'sort' => 5, 'is_main' => true]);
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'sort' => 3, 'wizard_step' => 2]);
        Vehicle::factory()->published()->create();
        Sanctum::actingAs($this->owner);

        $response = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/me/vehicles')->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$main->id, $second->id, $draft->id])
            ->and($response->json('data.2.wizard'))->toBe(['step' => 2, 'total_steps' => 4])
            ->and($response->json('data.0.wizard'))->toBeNull()
            ->and($response->json('data.0.completeness.percent'))->toBeInt()
            ->and($response->json('data.0.completeness.line'))->toContain('vollständig')
            ->and($response->json('data.0.completeness.hint'))->toContain('bis zum vollständigen Build')
            ->and($response->json('data.0.completeness.missing.0'))->toHaveKeys(['key', 'label', 'section']);
    });

    it('pages with a cursor and refuses a forged one', function () {
        Vehicle::factory()->count(3)->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $first = $this->getJson('/api/v1/me/vehicles?per_page=2')->assertOk()->assertJsonCount(2, 'data');
        $cursor = $first->json('meta.next_cursor');

        expect($cursor)->toBeString();

        $this->getJson('/api/v1/me/vehicles?per_page=2&cursor='.$cursor)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/me/vehicles?cursor=forged')->assertUnprocessable();
    });

    it('does not ask the database once per vehicle', function () {
        foreach (range(1, 5) as $i) {
            publishedVehicle($this->owner);
        }

        Sanctum::actingAs($this->owner);
        DB::enableQueryLog();

        $this->getJson('/api/v1/me/vehicles')->assertOk()->assertJsonCount(5, 'data');

        expect(count(DB::getQueryLog()))->toBeLessThan(20);
    });

    it('needs a sign-in', function () {
        $this->getJson('/api/v1/me/vehicles')->assertUnauthorized();
    });
});

describe('GET vehicles/{id}', function () {
    it('gives the owner completeness, QR and photos', function () {
        $vehicle = publishedVehicle($this->owner);
        $vehicle->qrCodes()->create(['code' => 'AAAAAAAA']);
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertOk()
            ->assertJsonPath('data.qr.code', 'AAAAAAAA')
            ->assertJsonPath('data.photo_count', 1)
            ->assertJsonStructure(['data' => ['completeness' => ['percent', 'missing'], 'specs' => ['power_value'], 'photos']]);
    });

    it('gives others the same shape without what is the owner\'s', function () {
        $vehicle = publishedVehicle($this->owner);
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertOk()
            ->assertJsonPath('data.completeness', null)
            ->assertJsonPath('data.qr', null)
            ->assertJsonPath('data.wizard', null);
    });

    it('does not exist for those who may not see it', function (Closure $state) {
        $vehicle = $state($this->owner);
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertNotFound();
    })->with([
        'draft' => [fn (User $owner) => Vehicle::factory()->create(['owner_id' => $owner->id])],
        'private' => [fn (User $owner) => Vehicle::factory()->private()->create(['owner_id' => $owner->id])],
    ]);

    it('is gone for the owner once deleted', function () {
        $vehicle = publishedVehicle($this->owner);
        $vehicle->delete();
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$vehicle->id}")->assertNotFound();
    });
});

describe('PATCH vehicles/{id}', function () {
    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['nickname' => 'Bayside'])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));

    it('changes only what was sent and resumes the wizard', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'nickname' => 'Alt', 'color' => 'Rot']);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['nickname' => 'Neu', 'wizard_step' => 3])->assertOk()
            ->assertJsonPath('data.nickname', 'Neu')
            ->assertJsonPath('data.color', 'Rot')
            ->assertJsonPath('data.wizard.step', 3);
    });

    it('drops a model that no longer fits when the make changes, and free text clears the catalogue', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $make = Make::factory()->create();
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['make_id' => $make->id])->assertOk()
            ->assertJsonPath('data.make_id', $make->id)
            ->assertJsonPath('data.model_id', null)
            ->assertJsonPath('data.generation_id', null);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['make_text' => 'Lada'])->assertOk()
            ->assertJsonPath('data.make_id', null)
            ->assertJsonPath('data.make_text', 'Lada');
    });

    it('moves the slug with the names, keeps the public id, and ignores a wizard step once published', function () {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        $make = Make::factory()->create(['name' => 'Mazda']);
        $model = VehicleModel::factory()->create(['make_id' => $make->id, 'name' => 'RX-7']);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['make_id' => $make->id, 'model_id' => $model->id, 'wizard_step' => 2])->assertOk()
            ->assertJsonPath('data.slug', 'mazda-rx-7-'.strtolower($vehicle->public_id))
            ->assertJsonPath('data.wizard', null);
    });

    it('sets a finished photo of this vehicle as cover, nothing else', function () {
        $vehicle = publishedVehicle($this->owner);
        $second = Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id]);
        $foreign = Media::factory()->forModel(Vehicle::factory()->create())->create();
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['cover_media_id' => $second->id])->assertOk()->assertJsonPath('data.cover.id', $second->id);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['cover_media_id' => $foreign->id])->assertUnprocessable()->assertJsonValidationErrorFor('cover_media_id');
    });

    it('queues the search rebuild for a published vehicle, not for a draft', function () {
        Queue::fake();
        $published = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$draft->id}", ['nickname' => 'x'])->assertOk();
        Queue::assertNothingPushed();

        $this->patchJson("/api/v1/vehicles/{$published->id}", ['nickname' => 'x'])->assertOk();
        Queue::assertPushed(RebuildVehicleSearch::class, fn (RebuildVehicleSearch $job): bool => $job->vehicleId === $published->id);
    });

    it('refuses a publishing restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['nickname' => 'x'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});

describe('PUT vehicles/{id}/specs', function () {
    it('stores power as entered, with the normalised value next to it', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", [
            'engine_code' => 'RB26DETT',
            'engine_text' => '2,6 l R6 Biturbo',
            'displacement_cc' => 2568,
            'fuel' => 'petrol',
            'aspiration' => 'biturbo',
            'power_value' => 375,
            'power_unit' => 'kw',
            'power_source' => 'measured',
            'torque_nm' => 540,
            'torque_source' => 'measured',
            'drivetrain' => 'all',
            'gearbox' => 'manual',
        ])->assertOk()
            ->assertJsonPath('data.specs.power_unit', 'kw')
            ->assertJsonPath('data.specs.power_source', 'measured')
            ->assertJsonPath('data.spec_strip.0', ['key' => 'power', 'value' => '510', 'unit' => 'PS', 'label' => 'PS'])
            ->assertJsonPath('data.spec_strip.1.value', '540')
            ->assertJsonPath('data.spec_strip.3.value', 'AWD')
            ->assertJsonPath('data.subline_parts.0', (string) $vehicle->model_year)
            ->assertJsonPath('data.subline_parts.1', '2,6 l R6 Biturbo (RB26DETT)');

        $specs = VehicleSpec::query()->findOrFail($vehicle->id);

        expect($specs->power_value)->toBe(375.0)->and($specs->power_ps)->toBe(509.86);
    });

    it('replaces: a key that is not sent is empty afterwards', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['power_value' => 300, 'power_unit' => 'ps', 'gearbox' => 'manual'])->assertOk();
        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['gearbox' => 'automatic'])->assertOk()
            ->assertJsonPath('data.specs.power_value', null)
            ->assertJsonPath('data.specs.power_ps', null)
            ->assertJsonPath('data.specs.gearbox', 'automatic');
    });

    it('validates', function (array $body, string $field) {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", $body)->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'unit unknown' => [['power_value' => 300, 'power_unit' => 'bhp'], 'power_unit'],
        'value without unit' => [['power_value' => 300], 'power_unit'],
        'unit without value' => [['power_unit' => 'ps'], 'power_value'],
        'negative power' => [['power_value' => -1, 'power_unit' => 'ps'], 'power_value'],
        'absurd power' => [['power_value' => 100000, 'power_unit' => 'ps'], 'power_value'],
        'source unknown' => [['power_value' => 1, 'power_unit' => 'ps', 'power_source' => 'dream'], 'power_source'],
        'torque as text' => [['torque_nm' => 'viel'], 'torque_nm'],
        'drivetrain unknown' => [['drivetrain' => 'hover'], 'drivetrain'],
        'gearbox unknown' => [['gearbox' => 'magic'], 'gearbox'],
        'fuel unknown' => [['fuel' => 'kerosin'], 'fuel'],
        'aspiration unknown' => [['aspiration' => 'x'], 'aspiration'],
        'displacement zero' => [['displacement_cc' => 0], 'displacement_cc'],
    ]);

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/specs", ['gearbox' => 'manual'])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));
});

describe('POST vehicles/{id}/publish', function () {
    it('publishes, gives the first vehicle main status, creates the one active QR and fills search', function () {
        $vehicle = completeDraft($this->owner);
        Sanctum::actingAs($this->owner);

        $response = $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish", ['visibility' => 'unlisted'])->assertOk()
            ->assertJsonPath('data.status', 'published')
            ->assertJsonPath('data.visibility', 'unlisted')
            ->assertJsonPath('data.is_main', true)
            ->assertJsonPath('data.wizard', null);

        $code = $response->json('data.qr.code');

        expect(Codes::isValid($code))->toBeTrue()
            ->and($response->json('data.qr.url'))->toEndWith('/C/'.$code)
            ->and($vehicle->qrCodes()->where('status', QrStatus::Active)->count())->toBe(1)
            ->and(VehicleSearch::query()->find($vehicle->id)?->is_public)->toBeFalse()
            ->and($vehicle->refresh()->published_at)->not->toBeNull()
            ->and($vehicle->cover_media_id)->not->toBeNull();
    });

    it('leaves an existing main vehicle alone', function () {
        $main = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'is_main' => true]);
        $vehicle = completeDraft($this->owner);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertOk()->assertJsonPath('data.is_main', false);

        expect($main->refresh()->is_main)->toBeTrue();
    });

    it('lists everything that is missing', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => User::factory()->create(['username' => null])->id, 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'model_year' => null]);
        Sanctum::actingAs($vehicle->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertUnprocessable()
            ->assertJsonPath('code', 'vehicle_incomplete')
            ->assertJsonPath('missing', ['make', 'model', 'model_year', 'photo', 'username'])
            ->assertJsonValidationErrors(['make', 'model', 'model_year', 'photo', 'username']);

        expect($vehicle->refresh()->status)->toBe(VehicleStatus::Draft)
            ->and($vehicle->qrCodes()->count())->toBe(0);
    });

    it('counts only finished photos', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'model_year' => 2020]);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'status' => MediaStatus::Processing]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertUnprocessable()->assertJsonPath('missing', ['photo']);
    });

    it('does not count a rejected photo either', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'model_year' => 2020]);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id, 'moderation_status' => 'rejected']);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertUnprocessable()->assertJsonPath('missing', ['photo']);
    });

    it('accepts free text for make and model', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id, 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Lada', 'model_text' => 'Niva', 'model_year' => 1990]);
        Media::factory()->forModel($vehicle)->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertOk()
            ->assertJsonPath('data.slug', 'lada-niva-'.strtolower($vehicle->public_id));
    });

    it('refuses by who asks', function (Closure $who, int $status, ?string $code) {
        $member = $who($this->owner);
        $vehicle = completeDraft($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $response = $this->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with([
        'guest' => [fn (User $owner) => null, 401, 'unauthenticated'],
        'other member' => [fn (User $owner) => User::factory()->create(), 403, 'forbidden'],
        'unverified member' => [fn (User $owner) => User::factory()->unverified()->create(), 403, 'email_not_verified'],
    ]);

    it('says email_not_verified to the unverified owner and account_restricted to the restricted one', function () {
        $unverified = User::factory()->unverified()->create();
        $draft = completeDraft($unverified);
        Sanctum::actingAs($unverified);
        $this->postJson("/api/v1/vehicles/{$draft->id}/publish")->assertForbidden()->assertJsonPath('code', 'email_not_verified');

        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $draft = completeDraft($restricted);
        Sanctum::actingAs($restricted);
        $this->postJson("/api/v1/vehicles/{$draft->id}/publish")->assertForbidden()->assertJsonPath('code', 'account_restricted');

        $suspended = User::factory()->suspended()->create();
        $draft = completeDraft($suspended);
        Sanctum::actingAs($suspended);
        $this->postJson("/api/v1/vehicles/{$draft->id}/publish")->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });

    it('replays with the same key and cannot publish twice without one', function () {
        $vehicle = completeDraft($this->owner);
        Sanctum::actingAs($this->owner);

        $first = $this->withHeader('Idempotency-Key', 'pub-1')->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertOk();
        $this->withHeader('Idempotency-Key', 'pub-1')->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertOk()->assertJsonPath('data.qr.code', $first->json('data.qr.code'));
        $row = DB::table('vehicles')->where('id', $vehicle->id)->first();

        // ADR-176(a): a second publish answers with the vehicle as it is and publishes nothing again.
        $this->withoutHeader('Idempotency-Key')->postJson("/api/v1/vehicles/{$vehicle->id}/publish")->assertOk()
            ->assertJsonPath('data.qr.code', $first->json('data.qr.code'))
            ->assertJsonPath('data.published_at', $first->json('data.published_at'));

        expect($vehicle->qrCodes()->count())->toBe(1)
            ->and(DB::table('vehicles')->where('id', $vehicle->id)->first())->toEqual($row);
    });
});

describe('POST vehicles/{id}/main', function () {
    it('moves the main status and keeps it unique', function () {
        $old = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'is_main' => true]);
        $new = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$new->id}/main")->assertOk()->assertJsonPath('data.is_main', true);

        expect($old->refresh()->is_main)->toBeFalse()
            ->and($this->owner->vehicles()->where('is_main', true)->count())->toBe(1);
    });

    it('refuses a draft', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$draft->id}/main")->assertForbidden();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/main")->assertStatus($status);
    })->with(ownerOnlyMatrix(200));
});

describe('PUT me/vehicles/order', function () {
    it('takes every vehicle except drafts', function () {
        $a = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'sort' => 1]);
        $b = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'sort' => 2]);
        Vehicle::factory()->create(['owner_id' => $this->owner->id, 'sort' => 3]);
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/me/vehicles/order', ['ids' => [$b->id, $a->id]])->assertOk();

        expect($b->refresh()->sort)->toBe(0)->and($a->refresh()->sort)->toBe(1);
    });

    it('refuses a list that is not complete or holds a stranger', function (Closure $ids) {
        $a = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        $b = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/me/vehicles/order', ['ids' => $ids($a, $b)])->assertUnprocessable()->assertJsonValidationErrorFor('ids');
    })->with([
        'one missing' => [fn ($a, $b) => [$a->id]],
        'a foreign one' => [fn ($a, $b) => [$a->id, $b->id, Vehicle::factory()->published()->create()->id]],
    ]);

    it('needs a sign-in and no publishing restriction', function () {
        $this->putJson('/api/v1/me/vehicles/order', ['ids' => []])->assertUnauthorized();

        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
        $this->putJson('/api/v1/me/vehicles/order', ['ids' => []])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});

describe('PATCH vehicles/{id}/visibility', function () {
    it('takes a private or unlisted vehicle out of search within the request', function (string $to) {
        Queue::fake();
        $vehicle = publishedVehicle($this->owner);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        expect(VehicleSearch::query()->findOrFail($vehicle->id)->is_public)->toBeTrue();

        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => $to])->assertOk()->assertJsonPath('data.visibility', $to);

        expect(VehicleSearch::query()->findOrFail($vehicle->id)->is_public)->toBeFalse();
        Queue::assertNothingPushed();
    })->with(['private', 'unlisted']);

    it('lets a restricted member hide a vehicle but not show one', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'public'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();
    });

    it('validates', function () {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'friends'])->assertUnprocessable()->assertJsonValidationErrorFor('visibility');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));
});

describe('DELETE vehicles/{id}', function () {
    it('revokes the QR, leaves search at once, withdraws the photos and hands over main', function () {
        Queue::fake();
        $vehicle = publishedVehicle($this->owner, ['is_main' => true]);
        $next = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'sort' => 2]);
        $qr = app(QrCodes::class)->ensureActive($vehicle);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        Sanctum::actingAs($this->owner);

        $this->deleteJson("/api/v1/vehicles/{$vehicle->id}")->assertNoContent();

        expect(Vehicle::withTrashed()->findOrFail($vehicle->id)->trashed())->toBeTrue()
            ->and($qr->refresh()->status)->toBe(QrStatus::Revoked)
            ->and($qr->revoked_reason)->toBe(QrRevocationReason::VehicleDeleted)
            ->and(VehicleSearch::query()->find($vehicle->id))->toBeNull()
            ->and(Media::withTrashed()->where('mediable_id', $vehicle->id)->first()->trashed())->toBeTrue()
            ->and($next->refresh()->is_main)->toBeTrue();
    });

    it('stays open under a publishing restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->deleteJson("/api/v1/vehicles/{$vehicle->id}")->assertNoContent();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $vehicle = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->deleteJson("/api/v1/vehicles/{$vehicle->id}")->assertStatus($status);
    })->with(ownerOnlyMatrix(204));

    it('hard deletes after 30 days only', function () {
        $old = publishedVehicle($this->owner);
        $recent = publishedVehicle($this->owner);
        $old->delete();
        $recent->delete();
        Vehicle::withTrashed()->whereKey($old->id)->update(['deleted_at' => now()->subDays(31)]);

        $this->artisan('vehicles:prune')->assertSuccessful();

        expect(Vehicle::withTrashed()->find($old->id))->toBeNull()
            ->and(Vehicle::withTrashed()->find($recent->id))->not->toBeNull();
    });
});
