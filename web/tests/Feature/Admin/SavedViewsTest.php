<?php

use App\Models\AuditEvent;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Support/helpers.php';

/*
 * Personal saved views of the DataTable (admin_saved_views): every role, own views only, audited.
 */

$view = ['table' => 'audit', 'name' => 'Freigaben diese Woche', 'query' => ['filter' => ['action' => 'approval.'], 'sort' => '-occurred_at', 'per_page' => 50]];

it('lets every role save a view of its own', function () use ($view) {
    assertAdminMatrix('POST', '/admin/saved-views', ADMIN_ROLES, fn (TestResponse $r) => $r->assertStatus(303)->assertSessionHas('success', 'ui.table.views.saved'), $view);
});

it('stores, lists and audits a view', function () use ($view) {
    seedStaffRoles();
    $owner = staffWithRole('owner');

    actingAsStaff($owner)->from('/admin/audit')->post('/admin/saved-views', $view)->assertRedirect('/admin/audit');

    $row = DB::table('admin_saved_views')->sole();
    expect($row->staff_id)->toBe($owner->id)->and(json_decode($row->query, true))->toEqual($view['query']);
    expect(AuditEvent::query()->where('action', 'admin.saved_view.saved')->exists())->toBeTrue();

    actingAsStaff($owner)->get('/admin/audit')
        ->assertInertia(fn (AssertableInertia $page) => $page->where('views.0.name', 'Freigaben diese Woche')->where('views.0.query.per_page', 50));
});

it('replaces a view of the same name instead of duplicating it', function () use ($view) {
    seedStaffRoles();
    $owner = staffWithRole('owner');

    actingAsStaff($owner)->post('/admin/saved-views', $view);
    actingAsStaff($owner)->post('/admin/saved-views', [...$view, 'query' => ['filter' => [], 'sort' => 'action', 'per_page' => 25]]);

    expect(DB::table('admin_saved_views')->count())->toBe(1)
        ->and(json_decode((string) DB::table('admin_saved_views')->value('query'), true)['sort'])->toBe('action');
});

it('never shows or deletes another staff member\'s view', function () use ($view) {
    seedStaffRoles();
    $owner = staffWithRole('owner');
    $admin = staffWithRole('admin');

    actingAsStaff($owner)->post('/admin/saved-views', $view);
    $id = (string) DB::table('admin_saved_views')->value('id');

    actingAsStaff($admin)->get('/admin/audit')->assertInertia(fn (AssertableInertia $page) => $page->where('views', []));
    assertAdminErrorPage(actingAsStaff($admin)->delete("/admin/saved-views/{$id}"), 404);
    expect(DB::table('admin_saved_views')->count())->toBe(1);

    actingAsStaff($owner)->from('/admin/audit')->delete("/admin/saved-views/{$id}")->assertRedirect('/admin/audit')->assertSessionHas('success', 'ui.table.views.deleted');
    expect(DB::table('admin_saved_views')->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', 'admin.saved_view.deleted')->exists())->toBeTrue();
});

it('validates table, name and query', function (array $data, string $field) {
    seedStaffRoles();

    actingAsStaff(staffWithRole('owner'))->post('/admin/saved-views', $data)->assertSessionHasErrors($field);
})->with([
    'malformed table' => [['table' => 'Audit; drop', 'name' => 'Neu', 'query' => ['sort' => 'x']], 'table'],
    'long table' => [['table' => str_repeat('a', 61), 'name' => 'Neu', 'query' => ['sort' => 'x']], 'table'],
    'short name' => [['table' => 'audit', 'name' => 'x', 'query' => ['sort' => 'action']], 'name'],
    'extra query key' => [['table' => 'audit', 'name' => 'Neu', 'query' => ['sort' => 'action', 'select' => '*']], 'query'],
    'bad per page' => [['table' => 'audit', 'name' => 'Neu', 'query' => ['per_page' => 1000]], 'query.per_page'],
    'bad sort' => [['table' => 'audit', 'name' => 'Neu', 'query' => ['sort' => 'action; drop']], 'query.sort'],
]);

it('caps the views per table at 20', function () {
    seedStaffRoles();
    $owner = staffWithRole('owner');

    foreach (range(1, 20) as $n) {
        actingAsStaff($owner)->post('/admin/saved-views', ['table' => 'audit', 'name' => "Ansicht {$n}", 'query' => ['sort' => 'action']]);
    }

    actingAsStaff($owner)->post('/admin/saved-views', ['table' => 'audit', 'name' => 'Ansicht 21', 'query' => ['sort' => 'action']])->assertSessionHasErrors('name');
    actingAsStaff($owner)->post('/admin/saved-views', ['table' => 'audit', 'name' => 'Ansicht 3', 'query' => ['sort' => '-action']])->assertSessionHasNoErrors();
    expect(DB::table('admin_saved_views')->count())->toBe(20);
});
