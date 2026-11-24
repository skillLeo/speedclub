<?php

use App\Models\Role;
use App\Models\StickerDesign;
use App\Models\User;
use App\Services\Qr\QrCodes;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Stickers/StickerTestHelpers.php';

/**
 * ADM-65 Sticker-Designs, the page (M5.4 admin; m5.4-contract §8): the Vue page `Stickers/Designs/Index` exists and renders for every role
 * that holds `stickers.print` (Owner, Admin, a print-partner role with only that atom), everyone else gets the 403 page; the props are
 * exactly what the page reads (rows/query/views, each row with the keys of its `DesignRow` type) and carry no member contact data. The
 * data rules (filters, downloads, audit) are proved in tests/Feature/Stickers/StickerAdminTest.php.
 */
const STICKER_ROW_KEYS = [
    'id', 'reference', 'version', 'template', 'size', 'size_mm', 'colourway', 'material', 'mirrored', 'qr', 'scan_test', 'state',
    'validated_at', 'order_requested_at', 'code', 'vehicle', 'owner', 'downloads', 'created_at',
];

beforeEach(function () {
    $this->member = User::factory()->create(['username' => 'mara.r34', 'email' => 'mara.r34@example.test']);
    [$this->vehicle, $this->qr] = stkCar($this->member);
    $this->validated = StickerDesign::factory()->validated($this->qr->id)->create(['vehicle_id' => $this->vehicle->id, 'order_requested_at' => now()]);
    $this->draft = StickerDesign::factory()->create(['vehicle_id' => $this->vehicle->id, 'version' => 2, 'template' => 'round']);
});

/** Every key of a nested array, recursively. @return list<string> */
function stickerPageKeys(mixed $value): array
{
    if (! is_array($value)) {
        return [];
    }

    $keys = [];
    foreach ($value as $key => $item) {
        if (is_string($key)) {
            $keys[] = $key;
        }
        array_push($keys, ...stickerPageKeys($item));
    }

    return $keys;
}

it('renders the page for Owner and Admin and refuses every other role', function () {
    assertAdminMatrix('GET', '/admin/stickers/designs', ['owner', 'admin'], function (TestResponse $response, string $role): void {
        $response->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Stickers/Designs/Index')
            ->has('rows.data', 2)
            ->has('rows.meta')
            ->has('query.filter')
            ->where('query.sort', '-order_requested_at')
            ->has('views')
            ->where('staff.permissions', fn ($atoms) => collect($atoms)->contains('stickers.print')));
    });
});

it('gives the page the row shape it reads, a validated row with its print files first and the draft without', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('admin'));

    $props = $this->get('/admin/stickers/designs')->assertOk()->inertiaProps();
    $rows = $props['rows']['data'];

    foreach ($rows as $row) {
        expect(array_keys($row))->toEqualCanonicalizing(STICKER_ROW_KEYS);
    }
    expect($rows[0]['reference'])->toBe($this->validated->reference)
        ->and($rows[0]['state'])->toBe('validated')
        ->and($rows[0]['downloads'])->toBe([
            'pdf' => route('admin.stickers.designs.print-pdf', ['design' => $this->validated->reference]),
            'svg' => route('admin.stickers.designs.print-svg', ['design' => $this->validated->reference]),
        ])
        ->and($rows[1]['reference'])->toBe($this->draft->reference)
        ->and($rows[1]['state'])->toBe('draft')
        ->and($rows[1]['downloads'])->toBeNull()
        ->and($rows[1]['template'])->toBe('round');
});

it('sends no member contact data and no raw sticker code', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('owner'));

    $response = $this->get('/admin/stickers/designs')->assertOk();
    $keys = stickerPageKeys($response->inertiaProps('rows'));

    expect($keys)->not->toContain('email')->not->toContain('phone')->not->toContain('password');
    expect(json_encode($response->inertiaProps('rows')))->not->toContain('mara.r34@example.test');
    // The code goes out only in its display form ("7H2K QXMB"), as on the Sticker-Register.
    expect($response->inertiaProps('rows.data.0.code'))->toBe(['display_code' => app(QrCodes::class)->displayCode($this->qr->code), 'active' => true]);
});

it('renders for a print-partner role that holds only stickers.print, which sees no other admin page', function () {
    seedStaffRoles();
    $role = Role::create(['name' => 'print_partner', 'guard_name' => 'staff']);
    $role->givePermissionTo('stickers.print');
    actingAsStaff(staffWithRole('print_partner'));

    $this->get('/admin/stickers/designs')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Stickers/Designs/Index')
        ->has('rows.data', 2)
        ->where('staff.permissions', ['stickers.print']));
    assertAdminErrorPage($this->get('/admin/qr'), 403);
    assertAdminErrorPage($this->get('/admin/members'), 403);
});

it('echoes the filters and the sort the page shows, and keeps an unknown filter value empty', function (string $query, array $filter, string $sort, int $count) {
    seedStaffRoles();
    actingAsStaff(staffWithRole('owner'));

    $this->get('/admin/stickers/designs?'.$query)->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Stickers/Designs/Index')
        ->where('query.filter', $filter)
        ->where('query.sort', $sort)
        ->has('rows.data', $count));
})->with([
    'ordered preset' => ['filter[state]=ordered&sort=-order_requested_at', ['state' => 'ordered'], '-order_requested_at', 1],
    'validated preset' => ['filter[state]=validated&sort=-validated_at', ['state' => 'validated'], '-validated_at', 1],
    'drafts preset' => ['filter[state]=draft&sort=-created_at', ['state' => 'draft'], '-created_at', 1],
    'template round' => ['filter[template]=round', ['template' => 'round'], '-order_requested_at', 1],
    'username' => ['filter[q]=@mara', ['q' => '@mara'], '-order_requested_at', 2],
    'unknown state' => ['filter[state]=printed', ['state' => 'printed'], '-order_requested_at', 0],
]);

it('shows the nav entry only to staff with stickers.print', function (string $role, bool $sees) {
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));

    // The shell builds the nav from staff.permissions (modules/stickers.ts: atom stickers.print); the dashboard is open to every role.
    $this->get('/admin')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->where('staff.permissions', fn ($atoms) => collect($atoms)->contains('stickers.print') === $sees));
})->with([
    'owner' => ['owner', true],
    'admin' => ['admin', true],
    'moderator' => ['moderator', false],
    'support' => ['support', false],
    'content editor' => ['content_editor', false],
    'analyst' => ['analyst', false],
]);
