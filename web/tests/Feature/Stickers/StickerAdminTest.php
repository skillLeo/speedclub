<?php

use App\Enums\QrRevocationReason;
use App\Models\AuditEvent;
use App\Models\Role;
use App\Models\StickerDesign;
use App\Models\User;
use App\Services\Qr\QrCodes;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/StickerTestHelpers.php';
require_once dirname(__DIR__).'/Admin/Support/helpers.php';

/**
 * ADM "Sticker-Designs" data (m5.4-contract §8): the list props for admin-builder's page and the print partner's download by design id.
 * Atom stickers.print (Owner and Admin by default; any role an Owner gives it to on ADM-42). Every download is audited.
 */
beforeEach(function () {
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    [$this->vehicle, $this->qr] = stkCar($this->owner);
    $this->design = StickerDesign::factory()->validated($this->qr->id)->create(['vehicle_id' => $this->vehicle->id, 'order_requested_at' => now()]);
});

it('lists the designs for Owner and Admin only', function () {
    assertAdminMatrix('GET', '/admin/stickers/designs', ['owner', 'admin'], function (TestResponse $response): void {
        $response->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Stickers/Designs/Index', false)
            ->where('rows.data.0.reference', $this->design->reference)
            ->where('rows.data.0.state', 'validated')
            ->where('rows.data.0.size_mm', ['width' => 156, 'height' => 65])
            ->where('rows.data.0.owner.username', 'lukas.sc')
            ->where('rows.data.0.code.active', true)
            ->where('rows.data.0.downloads.pdf', route('admin.stickers.designs.print-pdf', ['design' => $this->design->reference]))
            ->has('query.filter')
            ->has('views'));
    });
});

it('opens the list to a print-partner role that holds only stickers.print', function () {
    seedStaffRoles();
    $role = Role::create(['name' => 'print_partner', 'guard_name' => 'staff']);
    $role->givePermissionTo('stickers.print');
    actingAsStaff(staffWithRole('print_partner'));

    $this->get('/admin/stickers/designs')->assertOk();
    $this->get('/admin/stickers/designs/'.$this->design->reference.'/print.pdf')->assertOk()->assertHeader('Content-Type', 'application/pdf');
    assertAdminErrorPage($this->get('/admin/qr'), 403);
});

it('filters by state, template and design id, code or username', function (string $filter, int $count) {
    [$other, $otherQr] = stkCar();
    StickerDesign::factory()->create(['vehicle_id' => $other->id, 'template' => 'round']);
    seedStaffRoles();
    actingAsStaff(staffWithRole('owner'));
    $filter = str_replace(['{ref}', '{code}'], [substr($this->design->reference, 0, 6), substr($this->qr->code, 0, 4)], $filter);

    $this->get('/admin/stickers/designs?'.$filter)->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Stickers/Designs/Index', false)
        ->has('rows.data', $count));
})->with([
    'all' => ['', 2],
    'drafts' => ['filter[state]=draft', 1],
    'validated' => ['filter[state]=validated', 1],
    'ordered' => ['filter[state]=ordered', 1],
    'round' => ['filter[template]=round', 1],
    'design id' => ['filter[q]={ref}', 1],
    'sticker code' => ['filter[q]={code}', 1],
    'username' => ['filter[q]=@lukas', 1],
    'nothing' => ['filter[q]=zzzzzz', 0],
]);

it('lets the print partner download PDF and SVG by design id or ULID, audited', function (string $format) {
    seedStaffRoles();
    $staff = staffWithRole('admin');
    actingAsStaff($staff);

    $this->get('/admin/stickers/designs/'.strtolower($this->design->reference).'/print.'.$format)->assertOk()
        ->assertHeader('Cache-Control', 'no-store, private')
        ->assertHeader('Content-Disposition', 'attachment; filename="speedclub-sticker-'.$this->design->reference.'-v1.'.$format.'"');
    $this->get('/admin/stickers/designs/'.$this->design->id.'/print.'.$format)->assertOk();

    $audit = AuditEvent::query()->where('action', 'sticker.print_downloaded')->latest('occurred_at')->firstOrFail();
    expect(AuditEvent::query()->where('action', 'sticker.print_downloaded')->count())->toBe(2)
        ->and((string) $audit->getAttribute('actor_id'))->toBe((string) $staff->id)
        ->and($audit->getAttribute('target_id'))->toBe($this->design->id)
        ->and($audit->getAttribute('after'))->toEqual(['reference' => $this->design->reference, 'version' => 1, 'format' => $format]);
})->with(['pdf', 'svg']);

it('refuses a draft and a design whose code was taken down, and audits nothing', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('owner'));
    $draft = StickerDesign::factory()->create(['vehicle_id' => $this->vehicle->id, 'version' => 2]);

    $this->get('/admin/stickers/designs/'.$draft->reference.'/print.pdf')->assertStatus(409);

    app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);
    $this->get('/admin/stickers/designs/'.$this->design->reference.'/print.pdf')->assertStatus(409);
    $this->get('/admin/stickers/designs/SD00000000/print.pdf')->assertNotFound();

    expect(AuditEvent::query()->where('action', 'sticker.print_downloaded')->count())->toBe(0);
});

it('needs stickers.print for the downloads', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('moderator'));

    assertAdminErrorPage($this->get('/admin/stickers/designs/'.$this->design->reference.'/print.pdf'), 403);
});
