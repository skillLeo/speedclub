<?php

use App\Enums\MaintenanceType;
use App\Enums\ModStatus;
use App\Http\RateLimits;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\Media;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/MaintenanceTestHelpers.php';

/**
 * M4.13 maintenance API (09 §8.8, §8.12, §11): items (MNT-01/02), the service log with private costs and photos, odometer, cost totals,
 * upcoming items. Owner-only everywhere; the offline outbox contract (client ids, Idempotency-Key, versions).
 */
beforeEach(function () {
    mntFlags();
    $this->owner = User::factory()->create(['username' => 'finn.jdm']);
    $this->vehicle = publishedVehicle($this->owner);
});

describe('authorisation', function () {
    it('keeps every maintenance route to the owner', function (Closure $who, int $status, string $method, string $uri, array $body, int $success) {
        $item = mntItem($this->vehicle);
        $log = mntLog($this->vehicle, ['item_id' => $item->id]);
        $uri = str_replace(['{v}', '{item}', '{log}'], [$this->vehicle->id, $item->id, $log->id], $uri);
        $viewer = $who($this->owner);
        mntActAs($viewer);
        $expected = $status === 200 ? $success : $status;

        $this->json($method, $uri, $body)->assertStatus($expected);
    })->with(mntMatrix(200))->with([
        'list items' => ['GET', '/api/v1/vehicles/{v}/maintenance-items', [], 200],
        'add item' => ['POST', '/api/v1/vehicles/{v}/maintenance-items', ['type' => 'custom', 'title' => 'Zahnriemen'], 201],
        'change item' => ['PATCH', '/api/v1/vehicles/{v}/maintenance-items/{item}', ['notes' => 'Freie Werkstatt'], 200],
        'delete item' => ['DELETE', '/api/v1/vehicles/{v}/maintenance-items/{item}', [], 204],
        'list log' => ['GET', '/api/v1/vehicles/{v}/maintenance-logs', [], 200],
        'show entry' => ['GET', '/api/v1/vehicles/{v}/maintenance-logs/{log}', [], 200],
        'add entry' => ['POST', '/api/v1/vehicles/{v}/maintenance-logs', ['type' => 'service', 'done_at' => '2026-10-01'], 201],
        'change entry' => ['PATCH', '/api/v1/vehicles/{v}/maintenance-logs/{log}', ['notes' => 'Rechnung liegt im Handschuhfach'], 200],
        'delete entry' => ['DELETE', '/api/v1/vehicles/{v}/maintenance-logs/{log}', [], 204],
        'odometer' => ['PUT', '/api/v1/vehicles/{v}/odometer', ['km' => 51000], 200],
        'costs' => ['GET', '/api/v1/vehicles/{v}/costs', [], 200],
    ]);

    it('answers 404 for a deleted vehicle and for an item of another vehicle', function () {
        $other = publishedVehicle($this->owner);
        $item = mntItem($other);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items/{$item->id}", ['notes' => 'x'])->assertNotFound();
        $this->vehicle->delete();
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items")->assertNotFound();
    });

    it('needs a member for the cross-vehicle reads and lets nobody else see them', function () {
        mntItem($this->vehicle, MaintenanceType::OilChange, ['next_due_at' => now()->addDays(5)->toDateString()]);

        $this->getJson('/api/v1/me/maintenance/upcoming')->assertUnauthorized();
        $this->getJson('/api/v1/me/maintenance/reminders')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/me/maintenance/upcoming')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/me/maintenance/reminders')->assertOk()->assertJsonCount(0, 'data.stages');
    });

    it('answers 404 feature_disabled while the flag is off, after 401 for a guest', function () {
        mntFlags(['maintenance' => false]);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items")->assertUnauthorized();
        Sanctum::actingAs($this->owner);
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items")->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->getJson('/api/v1/me/maintenance/upcoming')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('never puts maintenance, the odometer or costs into another member\'s or the public view of the vehicle', function () {
        $this->vehicle->forceFill(['odometer_km' => 48200])->save();
        mntLog($this->vehicle, ['cost_cents' => 18900, 'workshop' => 'Werkstatt am Ring']);
        Sanctum::actingAs(User::factory()->create());

        foreach (["/api/v1/vehicles/{$this->vehicle->id}", "/api/v1/public/vehicles/{$this->vehicle->slug}"] as $uri) {
            $body = (string) $this->getJson($uri)->getContent();
            expect($body)->not->toContain('odometer')->not->toContain('18900')->not->toContain('Werkstatt am Ring')->not->toContain('maintenance');
        }
    });
});

describe('items', function () {
    it('adds an oil change and computes the next due date and mileage from the last time and the interval', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", [
            'type' => 'oil_change', 'last_done_at' => '2026-05-10', 'last_done_km' => 40000, 'interval_months' => 12, 'interval_km' => 15000,
        ])->assertCreated()
            ->assertJsonPath('data.type', 'oil_change')
            ->assertJsonPath('data.next_due.date', '2027-05-10')
            ->assertJsonPath('data.next_due.km', 55000)
            ->assertJsonPath('data.next_due.pinned', false)
            ->assertJsonPath('data.lead_days', [14])
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.reminders.0.key', fn (string $key): bool => str_starts_with($key, 'mnt:') && str_ends_with($key, ':d2027-05-10:14'))
            ->assertJsonPath('data.reminders.1.key', fn (string $key): bool => str_ends_with($key, ':k55000'));
    });

    it('keeps the HU/AU item and the vehicle\'s HU/AU month as one, both ways, with the SET-23 lead times', function () {
        $this->owner->forceFill(['maintenance_prefs' => ['hu_au_lead_days' => [21, 7]]])->save();
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'hu_au', 'next_due_at' => '2027-03-17'])->assertCreated()
            ->assertJsonPath('data.next_due.date', '2027-03-01')
            ->assertJsonPath('data.next_due.month', '2027-03')
            ->assertJsonPath('data.next_due.deadline', '2027-03-31')
            ->assertJsonPath('data.lead_days', [21, 7]);
        expect($this->vehicle->fresh()?->hu_au_due?->format('Y-m-d'))->toBe('2027-03-01');

        // GAR-06 moves the month: the item follows.
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['hu_au_due' => '2027-09'])->assertOk();
        expect(MaintenanceItem::query()->where('vehicle_id', $this->vehicle->id)->where('type', 'hu_au')->sole()->next_due_at?->toDateString())->toBe('2027-09-01');

        // An inspection logged: the next month is the done month + 24.
        $item = MaintenanceItem::query()->where('vehicle_id', $this->vehicle->id)->where('type', 'hu_au')->sole();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['item_id' => $item->id, 'done_at' => '2026-11-03', 'mileage_km' => 51000])->assertCreated();
        expect($this->vehicle->fresh()?->hu_au_due?->format('Y-m-d'))->toBe('2028-11-01');

        // Deleting the item clears the month.
        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items/{$item->id}")->assertNoContent();
        expect($this->vehicle->fresh()?->hu_au_due)->toBeNull();
    });

    it('makes the HU/AU item when GAR-06 sets the month on a vehicle without one', function () {
        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['hu_au_due' => '2027-04'])->assertOk();

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items")->assertOk()
            ->assertJsonPath('data.0.type', 'hu_au')
            ->assertJsonPath('data.0.next_due.month', '2027-04')
            ->assertJsonPath('data.0.lead_days', [30, 14, 1]);
    });

    it('allows one item per type but any number of custom ones, and answers a second one with the first', function () {
        Sanctum::actingAs($this->owner);
        $first = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'service'])->assertCreated()->json('data.id');

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'service'])->assertStatus(409)
            ->assertJsonPath('code', 'conflict')->assertJsonPath('current.id', $first);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'custom', 'title' => 'Zahnriemen'])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'custom', 'title' => 'Klimaservice'])->assertCreated();
    });

    it('validates the editor fields', function (array $body, string $field) {
        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'oil_change', ...$body])->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'unknown type' => [['type' => 'wash'], 'type'],
        'custom without title' => [['type' => 'custom'], 'title'],
        'interval too long' => [['interval_months' => 200], 'interval_months'],
        'lead days too many' => [['lead_days' => [30, 14, 7, 1]], 'lead_days'],
        'lead day too far' => [['lead_days' => [120]], 'lead_days.0'],
        'last time in the future' => [['last_done_at' => now()->addMonth()->toDateString()], 'last_done_at'],
        'not a date' => [['next_due_at' => '03/2027'], 'next_due_at'],
        'negative km' => [['last_done_km' => -5], 'last_done_km'],
        'bad client id' => [['id' => 'not-a-ulid'], 'id'],
    ]);

    it('replays a client id from the outbox instead of making a second item, and refuses a foreign one', function () {
        Sanctum::actingAs($this->owner);
        $id = strtolower((string) Str::ulid());

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['id' => $id, 'type' => 'custom', 'title' => 'Zahnriemen'])->assertCreated()->assertJsonPath('data.id', $id);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['id' => strtoupper($id), 'type' => 'custom', 'title' => 'Zahnriemen'])->assertOk()->assertJsonPath('data.id', $id);
        expect(MaintenanceItem::query()->count())->toBe(1);

        $other = publishedVehicle($this->owner);
        $this->postJson("/api/v1/vehicles/{$other->id}/maintenance-items", ['id' => $id, 'type' => 'custom', 'title' => 'x'])->assertStatus(409)->assertJsonPath('code', 'conflict');
    });

    it('answers a repeated Idempotency-Key with the first answer', function () {
        Sanctum::actingAs($this->owner);
        $headers = ['Idempotency-Key' => 'mnt-item-1'];

        $first = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'custom', 'title' => 'Zahnriemen'], $headers)->assertCreated()->json('data.id');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'custom', 'title' => 'Zahnriemen'], $headers)->assertCreated()
            ->assertHeader('Idempotency-Replayed', 'true')->assertJsonPath('data.id', $first);
        expect(MaintenanceItem::query()->count())->toBe(1);
    });

    it('refuses an edit of an older version with 409 edit_conflict and the current item', function () {
        $item = mntItem($this->vehicle, MaintenanceType::OilChange, ['version' => 3, 'notes' => 'Server']);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items/{$item->id}", ['version' => 2, 'notes' => 'Gerät'])->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')->assertJsonPath('current.notes', 'Server')->assertJsonPath('current.version', 3);
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items/{$item->id}", ['version' => 3, 'notes' => 'Gerät'])->assertOk()
            ->assertJsonPath('data.notes', 'Gerät')->assertJsonPath('data.version', 4);
    });

    it('pins a date the member sets and lets the next log entry compute it again', function () {
        $item = mntItem($this->vehicle, MaintenanceType::Service, ['interval_months' => 24, 'interval_km' => null, 'last_done_at' => '2025-06-01', 'last_done_km' => null, 'next_due_at' => '2027-06-01', 'next_due_km' => null]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items/{$item->id}", ['next_due_at' => '2027-01-15'])->assertOk()
            ->assertJsonPath('data.next_due.date', '2027-01-15')->assertJsonPath('data.next_due.pinned', true);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['item_id' => $item->id, 'done_at' => '2026-11-02'])->assertCreated();

        expect($item->fresh()?->next_due_at?->toDateString())->toBe('2028-11-02')->and($item->fresh()?->due_pinned)->toBeFalse();
    });

    it('stops at 30 items per vehicle', function () {
        foreach (range(1, 30) as $n) {
            mntItem($this->vehicle, MaintenanceType::Custom, ['title' => 'Punkt '.$n]);
        }

        Sanctum::actingAs($this->owner);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items", ['type' => 'custom', 'title' => 'Einer zu viel'])->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    });

    it('lists the items nearest due first and the odometer in meta', function () {
        $this->vehicle->forceFill(['odometer_km' => 48200])->save();
        mntItem($this->vehicle, MaintenanceType::BrakeFluid, ['next_due_at' => now()->addMonths(8)->toDateString(), 'next_due_km' => null]);
        mntItem($this->vehicle, MaintenanceType::OilChange, ['next_due_at' => now()->subDays(3)->toDateString(), 'next_due_km' => null]);
        mntItem($this->vehicle, MaintenanceType::Custom, ['title' => 'Ohne Termin', 'next_due_at' => null, 'next_due_km' => null, 'last_done_at' => null]);
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-items")->assertOk()
            ->assertJsonPath('data.0.type', 'oil_change')->assertJsonPath('data.0.state', 'overdue')
            ->assertJsonPath('data.1.type', 'brake_fluid')->assertJsonPath('data.1.state', 'ok')
            ->assertJsonPath('data.2.state', 'unknown')
            ->assertJsonPath('meta.odometer.km', 48200);
    });
});

describe('service log', function () {
    it('logs a service with its private cost, moves the item and raises the odometer', function () {
        $item = mntItem($this->vehicle, MaintenanceType::OilChange, ['last_done_at' => '2025-11-01', 'last_done_km' => 30000, 'interval_months' => 12, 'interval_km' => 15000]);
        $this->vehicle->forceFill(['odometer_km' => 44000])->save();
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", [
            'item_id' => $item->id, 'done_at' => '2026-11-01', 'mileage_km' => 45100, 'workshop' => 'Werkstatt am Ring', 'cost_cents' => 18900, 'notes' => 'Öl 5W-30',
        ])->assertCreated()
            ->assertJsonPath('data.type', 'oil_change')
            ->assertJsonPath('data.cost.cents', 18900)
            ->assertJsonPath('data.cost.currency', 'EUR')
            ->assertJsonPath('data.workshop', 'Werkstatt am Ring')
            ->assertJsonPath('data.business_id', null);

        expect($item->fresh()?->last_done_at?->toDateString())->toBe('2026-11-01')
            ->and($item->fresh()?->next_due_km)->toBe(60100)
            ->and($this->vehicle->fresh()?->getAttribute('odometer_km'))->toBe(45100);
    });

    it('validates an entry and refuses an item of another vehicle', function () {
        $foreign = mntItem(publishedVehicle($this->owner));
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['done_at' => '2026-10-01'])->assertUnprocessable()->assertJsonValidationErrors('type');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['type' => 'service'])->assertUnprocessable()->assertJsonValidationErrors('done_at');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['type' => 'service', 'done_at' => '2026-10-01', 'cost_cents' => -1])->assertUnprocessable()->assertJsonValidationErrors('cost_cents');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['item_id' => $foreign->id, 'done_at' => '2026-10-01'])->assertUnprocessable()->assertJsonValidationErrors('item_id');
    });

    it('lists the log newest first, by item and year, with a cursor', function () {
        $item = mntItem($this->vehicle);
        mntLog($this->vehicle, ['item_id' => $item->id, 'done_at' => '2025-03-01']);
        mntLog($this->vehicle, ['done_at' => '2026-02-01', 'type' => MaintenanceType::Service]);
        mntLog($this->vehicle, ['item_id' => $item->id, 'done_at' => '2026-09-01']);
        Sanctum::actingAs($this->owner);

        $page = $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs?per_page=2")->assertOk()
            ->assertJsonPath('data.0.done_at', '2026-09-01')->assertJsonPath('data.1.done_at', '2026-02-01');
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs?per_page=2&cursor=".urlencode((string) $page->json('meta.next_cursor')))->assertOk()
            ->assertJsonPath('data.0.done_at', '2025-03-01');
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs?item_id={$item->id}")->assertOk()->assertJsonCount(2, 'data');
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs?year=2026")->assertOk()->assertJsonCount(2, 'data');
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs?cursor=forged")->assertUnprocessable();
    });

    it('refuses an edit of an older version and recomputes the item when an entry goes', function () {
        $item = mntItem($this->vehicle, MaintenanceType::OilChange, ['interval_months' => 12, 'interval_km' => null, 'last_done_at' => '2026-10-01', 'next_due_km' => null]);
        $older = mntLog($this->vehicle, ['item_id' => $item->id, 'done_at' => '2025-10-01', 'mileage_km' => 30000]);
        $newer = mntLog($this->vehicle, ['item_id' => $item->id, 'done_at' => '2026-10-01', 'mileage_km' => 44000, 'version' => 2]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$newer->id}", ['version' => 1, 'cost_cents' => 100])->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')->assertJsonPath('current.version', 2);
        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$newer->id}")->assertNoContent();

        expect($item->fresh()?->last_done_at?->toDateString())->toBe($older->done_at->toDateString())
            ->and($item->fresh()?->next_due_at?->toDateString())->toBe('2026-10-01');
        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$newer->id}")->assertNoContent();
    });

    it('replays a client id of the outbox', function () {
        Sanctum::actingAs($this->owner);
        $id = strtolower((string) Str::ulid());

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['id' => $id, 'type' => 'service', 'done_at' => '2026-10-01'])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['id' => $id, 'type' => 'service', 'done_at' => '2026-10-01'])->assertOk()->assertJsonPath('data.id', $id);
        expect(MaintenanceLog::query()->count())->toBe(1);
    });

    it('is rate limited on adding', function () {
        socLimitMnt('garage_writes');
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['type' => 'service', 'done_at' => '2026-10-01'])->assertCreated();
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs", ['type' => 'service', 'done_at' => '2026-10-02'])->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('photos', function () {
    beforeEach(function () {
        Storage::fake('public');
        Storage::fake('local');
        config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local']);
    });

    it('keeps receipt photos on the private disk behind signed URLs for the owner only', function () {
        $log = mntLog($this->vehicle);
        Sanctum::actingAs($this->owner);

        $photo = $this->post("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$log->id}/photos", ['file' => UploadedFile::fake()->image('beleg.jpg', 1200, 1600)], ['Accept' => 'application/json'])
            ->assertCreated()->json('data');
        $media = Media::query()->findOrFail($photo['id']);

        expect($media->getAttribute('disk'))->toBe('local')
            ->and(Storage::disk('public')->allFiles())->toBe([])
            ->and($photo['variants'])->not->toBeEmpty();

        $url = $photo['variants'][0]['url'];
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->get($url.'x')->assertForbidden();

        // A URL for another viewer: refused although the signature is valid.
        $other = User::factory()->create();
        $forged = URL::temporarySignedRoute('api.v1.maintenance-media.show', now()->addMinutes(10), ['media' => $media->id, 'width' => $photo['variants'][0]['width'], 'viewer' => $other->id]);
        $this->get($forged)->assertNotFound();

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$log->id}")->assertJsonPath('data.photos.0.id', $media->id);
        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$log->id}/photos/{$media->id}")->assertNoContent();
        expect(Media::query()->find($media->id))->toBeNull();
    });

    it('stops at six photos per entry and refuses other members', function () {
        $log = mntLog($this->vehicle);
        Media::factory()->count(6)->create(['owner_id' => $this->owner->id, 'mediable_type' => 'maintenance_log', 'mediable_id' => $log->id]);

        Sanctum::actingAs(User::factory()->create());
        $this->post("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$log->id}/photos", ['file' => UploadedFile::fake()->image('a.jpg', 800, 600)], ['Accept' => 'application/json'])->assertForbidden();

        Sanctum::actingAs($this->owner);
        $this->post("/api/v1/vehicles/{$this->vehicle->id}/maintenance-logs/{$log->id}/photos", ['file' => UploadedFile::fake()->image('a.jpg', 800, 600)], ['Accept' => 'application/json'])
            ->assertStatus(409)->assertJsonPath('code', 'limit_reached');
    });

    it('takes the photos of the service log back with the vehicle', function () {
        $log = mntLog($this->vehicle);
        $photo = Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => 'maintenance_log', 'mediable_id' => $log->id]);
        Sanctum::actingAs($this->owner);

        $this->deleteJson("/api/v1/vehicles/{$this->vehicle->id}")->assertNoContent();
        expect(Media::query()->find($photo->id))->toBeNull();
    });
});

describe('odometer, costs and upcoming', function () {
    it('sets the mileage and validates it', function () {
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/odometer", ['km' => 51234])->assertOk()->assertJsonPath('data.km', 51234);
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/odometer", ['km' => -1])->assertUnprocessable()->assertJsonValidationErrors('km');
        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/odometer", [])->assertUnprocessable()->assertJsonValidationErrors('km');
    });

    it('totals the private costs per year from the service log and mods, without planned mods', function () {
        seedModSchema();
        mntLog($this->vehicle, ['done_at' => '2026-03-01', 'cost_cents' => 18900]);
        mntLog($this->vehicle, ['done_at' => '2025-03-01', 'cost_cents' => 10000]);
        mntLog($this->vehicle, ['done_at' => '2025-04-01', 'cost_cents' => null]);
        modIn($this->vehicle, 'wheels_tires', [], ['cost_cents' => 250000, 'installed_on' => '2026-05-01', 'status' => ModStatus::Installed]);
        modIn($this->vehicle, 'wheels_tires', [], ['cost_cents' => 99900, 'installed_on' => '2026-05-01', 'status' => ModStatus::Planned]);
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/costs")->assertOk()
            ->assertJsonPath('data.currency', 'EUR')
            ->assertJsonPath('data.total_cents', 278900)
            ->assertJsonPath('data.maintenance_cents', 28900)
            ->assertJsonPath('data.mods_cents', 250000)
            ->assertJsonPath('data.years.0', ['year' => 2026, 'total_cents' => 268900, 'maintenance_cents' => 18900, 'mods_cents' => 250000])
            ->assertJsonPath('data.years.1.year', 2025);
    });

    it('lists upcoming items across the member\'s vehicles, overdue first, without deleted vehicles or other members', function () {
        $second = publishedVehicle($this->owner);
        mntItem($this->vehicle, MaintenanceType::BrakeFluid, ['next_due_at' => now()->addDays(20)->toDateString(), 'next_due_km' => null]);
        mntItem($second, MaintenanceType::OilChange, ['next_due_at' => now()->subDays(2)->toDateString(), 'next_due_km' => null]);
        mntItem($this->vehicle, MaintenanceType::Service, ['next_due_at' => now()->addYear()->toDateString(), 'next_due_km' => null]);
        $gone = publishedVehicle($this->owner);
        mntItem($gone, MaintenanceType::OilChange, ['next_due_at' => now()->addDays(3)->toDateString()]);
        $gone->delete();
        mntItem(publishedVehicle(), MaintenanceType::OilChange, ['next_due_at' => now()->addDays(3)->toDateString()]);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/me/maintenance/upcoming')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.type', 'oil_change')->assertJsonPath('data.0.state', 'overdue')->assertJsonPath('data.0.vehicle.id', $second->id)
            ->assertJsonPath('data.1.type', 'brake_fluid');
        $this->getJson('/api/v1/me/maintenance/upcoming?days=400')->assertOk()->assertJsonCount(3, 'data');
        $this->getJson('/api/v1/me/maintenance/upcoming?days=0')->assertUnprocessable();
    });
});

function socLimitMnt(string $name): void
{
    config(["speedclub.rate_limits.$name.max" => 1]);
    RateLimits::register();
}
