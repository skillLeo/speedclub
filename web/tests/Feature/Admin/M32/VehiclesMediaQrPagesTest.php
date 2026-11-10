<?php

use App\Enums\ApprovalStatus;
use App\Enums\ModerationStatus;
use App\Enums\QrStatus;
use App\Enums\ReportTargetType;
use App\Enums\Visibility;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Media;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\ModerationHolds;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/*
 * ADM-11/12 (vehicles), ADM-13 (media review), ADM-18/19 (QR) over HTTP: matrices for the six roles, decisions with a statement of
 * reasons behind a recent password, bulk hide above 100 → four-eyes, the queue never shows chat photos.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('public');
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create(['username' => 'jonas.v', 'locale' => 'de']);
    $this->vehicle = modVehicle($this->owner)->refresh();
});

describe('authorisation matrix', function () {
    it('lets vehicles.view open the list and the record', function (string $path) {
        $uri = str_replace('{id}', $this->vehicle->id, $path);
        assertAdminMatrix('GET', $uri, ['owner', 'admin', 'moderator', 'support', 'analyst'], fn (TestResponse $r) => $r->assertOk());
    })->with(['/admin/vehicles', '/admin/vehicles/{id}']);

    it('lets media.review open the queue', function () {
        assertAdminMatrix('GET', '/admin/media-review', ['owner', 'admin', 'moderator'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Media/Review')));
    });

    it('lets qr.view open the registry and the detail', function () {
        $qr = QrCode::factory()->create(['vehicle_id' => $this->vehicle->id]);
        assertAdminMatrix('GET', '/admin/qr', ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'], fn (TestResponse $r) => $r->assertOk());
        assertAdminMatrix('GET', '/admin/qr/'.$qr->id, ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Qr/Show')));
    });

    it('guards each write with its atom', function (string $method, string $path, array $allowed, array $data) {
        $photo = modPhoto($this->vehicle);
        $qr = QrCode::factory()->create(['vehicle_id' => $this->vehicle->id]);
        $uri = str_replace(['{vehicle}', '{photo}', '{qr}'], [$this->vehicle->id, $photo->id, $qr->id], $path);
        adm32WriteMatrix($method, $uri, $allowed, $data);
    })->with([
        'hide vehicle' => ['POST', '/admin/vehicles/{vehicle}/hide', ['owner', 'admin', 'moderator'], [...adm32Statement(), 'reason' => adm32Reason()]],
        'unhide vehicle' => ['POST', '/admin/vehicles/{vehicle}/unhide', ['owner', 'admin', 'moderator'], ['facts' => 'Der Inhalt ist wieder in Ordnung.', 'reason' => adm32Reason()]],
        'edit vehicle' => ['PATCH', '/admin/vehicles/{vehicle}', ['owner', 'admin'], ['nickname' => 'Bayside', 'reason' => adm32Reason()]],
        'delete vehicle' => ['DELETE', '/admin/vehicles/{vehicle}', ['owner', 'admin'], [...adm32Statement(), 'reason' => adm32Reason(), 'confirm' => 'nein']], // refused by validation: the vehicle stays for the next role
        'bulk hide' => ['POST', '/admin/vehicles/bulk-hide', ['owner', 'admin', 'moderator'], ['ids' => ['01jzzzzzzzzzzzzzzzzzzzzzzz'], ...adm32Statement(), 'reason' => adm32Reason()]],
        'approve photo' => ['POST', '/admin/media-review/{photo}/approve', ['owner', 'admin', 'moderator'], []],
        'hide photo' => ['POST', '/admin/media-review/{photo}/hide', ['owner', 'admin', 'moderator'], [...adm32Statement(), 'reason' => adm32Reason()]],
        'unhide photo' => ['POST', '/admin/media-review/{photo}/unhide', ['owner', 'admin', 'moderator'], ['facts' => 'Das Foto ist in Ordnung.', 'reason' => adm32Reason()]],
        'revoke qr' => ['POST', '/admin/qr/{qr}/revoke', ['owner', 'admin'], ['reason' => adm32Reason()]],
        'reissue qr' => ['POST', '/admin/qr/{qr}/reissue', ['owner', 'admin'], ['reason' => adm32Reason()]],
    ]);
});

describe('ADM-11/12 vehicles', function () {
    it('lists vehicles with owner, moderation state and counts, and filters hidden ones', function () {
        adm32SignedIn('moderator');

        $this->get('/admin/vehicles')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('rows.data.0.id', $this->vehicle->id)
            ->where('rows.data.0.owner.username', 'jonas.v')
            ->where('rows.data.0.hidden', false)
            ->has('makes'));

        $this->from('/admin/vehicles/'.$this->vehicle->id)->post('/admin/vehicles/'.$this->vehicle->id.'/hide', [...adm32Statement(), 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('success', 'vehicles.flash.hidden');

        expect($this->vehicle->refresh()->visibility)->toBe(Visibility::Private)
            ->and(app(ModerationHolds::class)->holds($this->vehicle))->toBeTrue();

        $this->get('/admin/vehicles?filter[moderation]=hidden')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1)->where('rows.data.0.hidden', true));
        $this->get('/admin/vehicles?filter[moderation]=visible')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 0));

        $this->from('/admin/vehicles/'.$this->vehicle->id)->post('/admin/vehicles/'.$this->vehicle->id.'/unhide', ['facts' => 'Der Inhalt ist wieder in Ordnung.', 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('success', 'vehicles.flash.unhidden');
        expect($this->vehicle->refresh()->visibility)->toBe(Visibility::Public);
    });

    it('reads only the open tab of the record', function () {
        modPhoto($this->vehicle);
        adm32SignedIn('owner');

        $this->get('/admin/vehicles/'.$this->vehicle->id)->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'details')->missing('photos')->where('vehicle.owner.username', 'jonas.v')->has('activity'));
        $this->get('/admin/vehicles/'.$this->vehicle->id.'?tab=photos')->assertInertia(fn (AssertableInertia $p) => $p->has('photos', 1));
        $this->get('/admin/vehicles/'.$this->vehicle->id.'?tab=qr')->assertInertia(fn (AssertableInertia $p) => $p->has('qr'));
    });

    it('needs the typed word to delete, then records the decision and deletes', function () {
        adm32SignedIn('admin');

        $this->from('/admin/vehicles/'.$this->vehicle->id)->delete('/admin/vehicles/'.$this->vehicle->id, [...adm32Statement(), 'reason' => adm32Reason(), 'confirm' => 'nein'])->assertSessionHasErrors('confirm');
        expect(Vehicle::query()->find($this->vehicle->id))->not->toBeNull();

        $this->delete('/admin/vehicles/'.$this->vehicle->id, [...adm32Statement(), 'reason' => adm32Reason(), 'confirm' => 'LÖSCHEN'])
            ->assertRedirect('/admin/vehicles');
        expect(Vehicle::query()->find($this->vehicle->id))->toBeNull()
            ->and(AuditEvent::query()->where('action', 'vehicle.deleted_by_staff')->count())->toBe(1);
    });

    it('asks for an approval to hide more than 100 vehicles and hides none', function () {
        $ids = Vehicle::factory()->published()->count(101)->create()->pluck('id')->all();
        adm32SignedIn('moderator');

        $this->from('/admin/vehicles')->post('/admin/vehicles/bulk-hide', ['ids' => $ids, ...adm32Statement(), 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('approval');

        expect(ApprovalRequest::query()->sole()->action)->toBe('vehicles.bulk_hide')
            ->and(Vehicle::query()->where('visibility', Visibility::Private)->count())->toBe(0);
    });

    it('refuses a stale password confirmation without a change', function () {
        seedStaffRoles();
        $this->withSession(['auth.password_confirmed_at' => time() - 301]);

        actingAsStaff(staffWithRole('owner'))->from('/admin/vehicles/'.$this->vehicle->id)
            ->post('/admin/vehicles/'.$this->vehicle->id.'/hide', [...adm32Statement(), 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('confirm_password', true);

        expect($this->vehicle->refresh()->visibility)->toBe(Visibility::Public);
    });
});

describe('ADM-13 media review', function () {
    it('shows new uploads, never chat photos, and approves one', function () {
        $photo = modPhoto($this->vehicle);
        Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => 'message', 'mediable_id' => strtolower((string) Str::ulid())]);
        adm32SignedIn('moderator');

        $this->get('/admin/media-review')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('tab', 'new')
            ->has('items.data', 1)
            ->where('items.data.0.id', $photo->id)
            ->where('items.data.0.vehicle.id', $this->vehicle->id)
            ->where('items.data.0.ai_score', null)
            ->where('aiTriage', false));

        $this->from('/admin/media-review')->post('/admin/media-review/'.$photo->id.'/approve')->assertStatus(303)->assertSessionHas('success', 'media.flash.approved');

        expect($photo->refresh()->reviewed_at)->not->toBeNull();
        $this->get('/admin/media-review')->assertInertia(fn (AssertableInertia $p) => $p->has('items.data', 0));
    });

    it('answers 404 for a chat photo on every action', function () {
        $chat = Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => 'message', 'mediable_id' => strtolower((string) Str::ulid())]);
        adm32SignedIn('owner');

        assertAdminErrorPage($this->post('/admin/media-review/'.$chat->id.'/approve'), 404);
        assertAdminErrorPage($this->post('/admin/media-review/'.$chat->id.'/hide', [...adm32Statement(), 'reason' => adm32Reason()]), 404);
    });

    it('hides a photo with a statement of reasons; it moves to Ausgeblendet', function () {
        $photo = modPhoto($this->vehicle);
        adm32SignedIn('moderator');

        $this->from('/admin/media-review')->post('/admin/media-review/'.$photo->id.'/hide', [...adm32Statement(), 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('success', 'media.flash.hidden');

        expect($photo->refresh()->moderation_status)->toBe(ModerationStatus::Rejected);
        $this->get('/admin/media-review?tab=hidden')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'hidden')->has('items.data', 1));
    });

    it('lists photos with an open case under Gemeldet', function () {
        $photo = modPhoto($this->vehicle);
        modReport(User::factory()->create(), ReportTargetType::Photo, $photo->id);
        adm32SignedIn('owner');

        $this->get('/admin/media-review?tab=reported')->assertInertia(fn (AssertableInertia $p) => $p->has('items.data', 1)->where('items.data.0.case.report_count', 1));
    });
});

describe('ADM-18/19 QR', function () {
    it('lists codes with scans of 7 and 30 days and resolves the detail by code', function () {
        $qr = QrCode::factory()->create(['vehicle_id' => $this->vehicle->id]);
        DB::table('qr_scan_daily')->insert([
            ['qr_code_id' => $qr->id, 'day' => now('Europe/Berlin')->toDateString(), 'count' => 3],
            ['qr_code_id' => $qr->id, 'day' => now('Europe/Berlin')->subDays(20)->toDateString(), 'count' => 5],
        ]);
        adm32SignedIn('analyst');

        $this->get('/admin/qr')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data.0.scans_7', 3)->where('rows.data.0.scans_30', 8));
        $this->get('/admin/qr/'.$qr->code)->assertInertia(fn (AssertableInertia $p) => $p->where('qr.id', $qr->id)->where('days', 30)->has('scans.series', 30)->where('scans.total', 8)->has('history'));
        $this->get('/admin/qr/'.$qr->id.'?days=90')->assertInertia(fn (AssertableInertia $p) => $p->where('days', 90)->has('scans.series', 90));
    });

    it('revokes with a reason (owner mailed), audited, and refuses a second revoke with a flash', function () {
        $qr = QrCode::factory()->create(['vehicle_id' => $this->vehicle->id]);
        adm32SignedIn('admin');

        $this->from('/admin/qr/'.$qr->id)->post('/admin/qr/'.$qr->id.'/revoke', ['reason' => adm32Reason()])->assertSessionHas('success', 'qr.flash.revoked');
        expect($qr->refresh()->status)->toBe(QrStatus::Revoked)
            ->and(AuditEvent::query()->where('action', 'qr.revoked_by_staff')->count())->toBe(1);

        $this->from('/admin/qr/'.$qr->id)->post('/admin/qr/'.$qr->id.'/revoke', ['reason' => adm32Reason()])->assertSessionHas('error', 'qr.flash.not_possible');
    });

    it('reissues and lands on the new code', function () {
        $qr = QrCode::factory()->create(['vehicle_id' => $this->vehicle->id]);
        adm32SignedIn('owner');

        $response = $this->post('/admin/qr/'.$qr->id.'/reissue', ['reason' => adm32Reason()])->assertStatus(303);
        $new = QrCode::query()->where('vehicle_id', $this->vehicle->id)->where('status', QrStatus::Active)->sole();

        expect($new->id)->not->toBe($qr->id);
        $response->assertRedirect('/admin/qr/'.$new->id);
    });
});

describe('four-eyes: no bypass', function () {
    it('never executes the vehicle bulk hide from its endpoint, whoever asks', function () {
        $ids = Vehicle::factory()->published()->count(101)->create()->pluck('id')->all();
        adm32SignedIn('owner');

        $this->post('/admin/vehicles/bulk-hide', ['ids' => $ids, ...adm32Statement(), 'reason' => adm32Reason()]);
        $this->post('/admin/vehicles/bulk-hide', ['ids' => $ids, ...adm32Statement(), 'reason' => adm32Reason()]);

        expect(ApprovalRequest::query()->where('status', ApprovalStatus::Pending)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'vehicle.bulk_hidden')->count())->toBe(0);
    });
});
