<?php

use App\Enums\BuildUpdateType;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\BuildUpdate;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Garage\BuildUpdates;
use Illuminate\Http\UploadedFile;
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
    Sanctum::actingAs($this->owner);
});

function addSuspension(Vehicle $vehicle, array $overrides = []): string
{
    return test()->postJson("/api/v1/vehicles/{$vehicle->id}/mods", [
        'category' => 'suspension',
        'brand_text' => 'KW',
        'part_name' => 'V3',
        'fields' => ['type' => 'coilover', 'lowering_front' => 35],
        ...$overrides,
    ])->assertCreated()->json('data.id');
}

describe('automatic updates', function () {
    it('renders "Fahrwerk: Serie → KW V3 · −35 mm" per viewer language', function () {
        addSuspension($this->vehicle);

        $de = $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect($de->json('data'))->toHaveCount(1)
            ->and($de->json('data.0.type'))->toBe('mod_added')
            // DQ-290: category and verb of the first change.
            ->and($de->json('data.0.type_label'))->toBe('Fahrwerk hinzugefügt')
            ->and($de->json('data.0.summary'))->toBe("Fahrwerk: Serie \u{2192} KW V3 · \u{2212}35 mm")
            ->and($de->json('data.0.changes.0.label'))->toBe('Fahrwerk')
            ->and($de->json('data.0.changes.0.before'))->toBe('Serie')
            ->and($de->json('data.0.changes.0.after'))->toBe("KW V3 · \u{2212}35 mm");

        $en = $this->withHeader('Accept-Language', 'en')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect($en->json('data.0.summary'))->toBe("Suspension: Stock \u{2192} KW V3 · \u{2212}35 mm")
            ->and($en->json('data.0.type_label'))->toBe('Suspension added');
    });

    it('merges what happens within 10 minutes into the open update', function () {
        addSuspension($this->vehicle);
        $this->travel(5)->minutes();
        addSuspension($this->vehicle, ['category' => 'exhaust', 'brand_text' => 'HKS', 'part_name' => 'Hi-Power', 'fields' => ['type' => 'catback']]);
        $this->travel(9)->minutes();
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/specs", ['torque_nm' => 500])->assertOk();

        $updates = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->get();

        expect($updates)->toHaveCount(1)
            ->and($updates->first()->payload['changes'])->toHaveCount(3);

        $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk()
            ->assertJsonPath('data.0.changes.2.text', "Drehmoment: keine Angabe \u{2192} 500 Nm");
    });

    it('starts a new update once the window has passed', function () {
        addSuspension($this->vehicle);
        $this->travel(11)->minutes();
        addSuspension($this->vehicle, ['category' => 'exhaust', 'brand_text' => 'HKS', 'part_name' => 'Hi-Power', 'fields' => ['type' => 'catback']]);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(2);
    });

    it('keeps the earliest before and the latest after for one modification', function () {
        $id = addSuspension($this->vehicle);
        $this->patchJson("/api/v1/mods/$id", ['part_name' => 'V4', 'title' => 'KW V4', 'fields' => ['type' => 'coilover', 'lowering_front' => 40]])->assertOk();

        $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonCount(1, 'data.0.changes')
            ->assertJsonPath('data.0.type', 'mod_added')
            ->assertJsonPath('data.0.summary', "Fahrwerk: Serie \u{2192} KW V4 · \u{2212}40 mm");
    });

    it('forgets a modification that was added and removed within the window', function () {
        $id = addSuspension($this->vehicle);

        $this->deleteJson("/api/v1/mods/$id")->assertNoContent();

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0);
    });

    it('records a change and a removal of an older modification, with details per field', function () {
        $id = addSuspension($this->vehicle);
        $this->travel(11)->minutes();

        $this->patchJson("/api/v1/mods/$id", ['fields' => ['type' => 'coilover', 'lowering_front' => 40]])->assertOk();

        $changed = $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect($changed->json('data.0.type'))->toBe('mod_changed')
            ->and($changed->json('data.0.summary'))->toBe("Fahrwerk: KW V3 · \u{2212}35 mm \u{2192} KW V3 · \u{2212}40 mm")
            ->and($changed->json('data.0.changes.0.details'))->toBe([])
            ->and($this->withHeader('Accept-Language', 'de')->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug().'/updates/'.$changed->json('data.0.id'))->assertOk()->json('data.changes.0.details'))->toBe([['label' => 'Tieferlegung vorne', 'before' => "\u{2212}35 mm", 'after' => "\u{2212}40 mm"]]);

        $this->travel(11)->minutes();
        $this->deleteJson("/api/v1/mods/$id")->assertNoContent();

        $removed = $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect($removed->json('data.0.type'))->toBe('mod_removed')
            ->and($removed->json('data.0.summary'))->toBe("Fahrwerk: KW V3 · \u{2212}40 mm \u{2192} entfernt");
    });

    it('stays quiet about what the public does not see', function () {
        $id = addSuspension($this->vehicle);
        $this->travel(11)->minutes();

        $this->patchJson("/api/v1/mods/$id", ['notes' => 'privat', 'cost_cents' => 99900, 'cost_public' => true])->assertOk();

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('shows nothing about a draft, the history starts with publishing', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);

        addSuspension($draft);
        $this->putJson("/api/v1/vehicles/{$draft->id}/specs", ['torque_nm' => 500])->assertOk();

        expect(BuildUpdate::query()->where('vehicle_id', $draft->id)->count())->toBe(0);
    });

    it('records changed specs, power in the viewer\'s unit, and drops a value changed back', function () {
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/specs", ['power_value' => 400, 'power_unit' => 'ps', 'power_source' => 'factory'])->assertOk();
        $this->travel(11)->minutes();
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/specs", ['power_value' => 500, 'power_unit' => 'ps', 'power_source' => 'measured'])->assertOk();

        $response = $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect($response->json('data.0.type'))->toBe('specs_changed')
            ->and($response->json('data.0.summary'))->toBe("Leistung: 400 PS (294 kW) · Herstellerangabe \u{2192} 500 PS (368 kW) · Prüfstand");

        $this->owner->forceFill(['power_display' => 'kw_ps'])->save();

        expect($this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->json('data.0.summary'))
            ->toBe("Leistung: 294 kW (400 PS) · Herstellerangabe \u{2192} 368 kW (500 PS) · Prüfstand");

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/specs", ['power_value' => 400, 'power_unit' => 'ps', 'power_source' => 'factory'])->assertOk();

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('needs three photos within the window, then counts on', function () {
        $upload = fn () => $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(640, 480))], ['Accept' => 'application/json'])->assertCreated();
        $count = fn () => BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count();

        $upload();
        $upload();
        expect($count())->toBe(0);

        $upload();
        expect($count())->toBe(1);

        $upload();
        expect($count())->toBe(1);

        $this->withHeader('Accept-Language', 'de')->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk()
            ->assertJsonPath('data.0.type', 'photos_added')
            ->assertJsonPath('data.0.summary', 'Fotos: 4 neue Fotos');
    });

    it('does not count two photos spread over two windows', function () {
        Media::factory()->forModel($this->vehicle)->count(2)->create(['owner_id' => $this->owner->id, 'created_at' => now()->subHour()]);

        $this->post("/api/v1/vehicles/{$this->vehicle->id}/media", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(640, 480))], ['Accept' => 'application/json'])->assertCreated();

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0);
    });

    it('starts a new update once the owner hid the open one', function () {
        addSuspension($this->vehicle);
        $open = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->firstOrFail();

        $this->patchJson("/api/v1/updates/{$open->id}", ['hidden' => true])->assertOk()->assertJsonPath('data.hidden', true);

        addSuspension($this->vehicle, ['category' => 'exhaust', 'brand_text' => 'HKS', 'part_name' => 'Hi-Power', 'fields' => ['type' => 'catback']]);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(2);
    });

    it('writes a backdated entry on its own, with the words it is given', function () {
        $mod = modIn($this->vehicle, 'suspension');
        $mod->setRelation('vehicle', $this->vehicle);

        $update = app(BuildUpdates::class)->backdated($mod, BuildUpdateType::ModAdded, now()->subYear(), ['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3']);

        expect($update->created_at->isPast())->toBeTrue()
            ->and($update->getAttribute('open_until'))->toBeNull()
            ->and($update->payload)->toMatchArray(['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3', 'category' => 'suspension']);
    });
});

describe('POST vehicles/{id}/updates', function () {
    it('writes a note on its own, never merged', function () {
        addSuspension($this->vehicle);

        $this->withHeader('Accept-Language', 'de')->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Heute Fahrwerk eingestellt.'])->assertCreated()
            ->assertJsonPath('data.type', 'note')
            ->assertJsonPath('data.note', 'Heute Fahrwerk eingestellt.')
            ->assertJsonPath('data.summary', 'Heute Fahrwerk eingestellt.')
            ->assertJsonPath('data.changes', [])
            ->assertJsonPath('data.hidden', false);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(2);
    });

    it('validates', function (mixed $note) {
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => $note])->assertUnprocessable()->assertJsonValidationErrorFor('note');
    })->with([
        'missing' => [null],
        'empty' => [''],
        'too long' => [str_repeat('x', 501)],
    ]);

    it('replays with the same Idempotency-Key', function () {
        $first = $this->withHeader('Idempotency-Key', 'note-1')->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Hallo'])->assertCreated();
        $this->withHeader('Idempotency-Key', 'note-1')->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Hallo'])->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('is rate limited', function () {
        config(['speedclub.rate_limits.garage_writes.max' => 1]);
        RateLimits::register();

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Eins'])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Zwei'])->assertTooManyRequests();
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        app('auth')->forgetGuards();
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/updates", ['note' => 'Hallo'])->assertStatus($status);
    })->with(ownerOnlyMatrix(201));

    it('refuses a publishing restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $member->id]);
        Sanctum::actingAs($member);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'Hallo'])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});

describe('GET vehicles/{id}/updates and PATCH updates/{id}', function () {
    it('pages newest first and keeps hidden ones with the owner', function () {
        $old = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'created_at' => now()->subDays(2)]);
        $hidden = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'created_at' => now()->subDay(), 'hidden' => true]);
        $new = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'created_at' => now()]);

        $first = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates?per_page=2")->assertOk();

        expect(array_column($first->json('data'), 'id'))->toBe([$new->id, $hidden->id]);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates?per_page=2&cursor=".$first->json('meta.next_cursor'))->assertOk()
            ->assertJsonPath('data.0.id', $old->id);

        Sanctum::actingAs(User::factory()->create());

        $others = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk();

        expect(array_column($others->json('data'), 'id'))->toBe([$new->id, $old->id]);
    });

    it('does not exist for those who may not see the vehicle', function () {
        $private = Vehicle::factory()->private()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs(User::factory()->create());

        $this->getJson("/api/v1/vehicles/{$private->id}/updates")->assertNotFound();
    });

    it('hides under a restriction, and refuses showing again', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $update = BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published()->create(['owner_id' => $member->id])->id]);
        Sanctum::actingAs($member);

        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => true])->assertOk()->assertJsonPath('data.hidden', true);
        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => false])->assertForbidden()->assertJsonPath('code', 'account_restricted');
        expect($update->fresh()?->hidden)->toBeTrue();
        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => 'vielleicht'])->assertUnprocessable()->assertJsonValidationErrorFor('hidden');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        app('auth')->forgetGuards();
        $update = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => true])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));

    it('reads rows from before the structured form', function () {
        BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'payload' => ['label' => 'Fahrwerk', 'before' => 'Serie', 'after' => 'KW V3']]);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/updates")->assertOk()->assertJsonPath('data.0.summary', "Fahrwerk: Serie \u{2192} KW V3");
    });
});
