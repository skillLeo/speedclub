<?php

use App\Enums\BusinessStatus;
use App\Enums\CaseStatus;
use App\Enums\EventStatus;
use App\Enums\MemberSecurityEvent;
use App\Enums\ProductStatus;
use App\Enums\ReportTargetType;
use App\Models\AuditEvent;
use App\Models\Brand;
use App\Models\Comment;
use App\Models\FeatureFlag;
use App\Models\MemberPasskey;
use App\Models\ModCategory;
use App\Models\ModerationCase;
use App\Models\Product;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Audit\Audit;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Businesses/BusinessTestHelpers.php';
require_once __DIR__.'/../../Events/EventTestHelpers.php';
require_once __DIR__.'/../../Social2/Social2TestHelpers.php';

/**
 * M4.17 Admin 2.0 server additions (09 §10.2): the ⌘K action targets (role matrix per kind, read-only, nothing leaks beyond the
 * atom), the dashboard's review queues (ADM-53/55 tiles), and the ADM-57 props the pages load on demand (brands for the drawer, merge
 * candidates) — only for catalog.manage.
 */
const M417_DECIDE = ['owner', 'admin', 'moderator'];
const M417_FLAGS = ['owner', 'admin'];

function m417As(string $role): mixed
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);

    return $staff;
}

it('guards the palette targets per kind by the action atom', function (string $kind, array $allowed) {
    assertAdminMatrix('GET', "/admin/palette/targets/$kind", $allowed, fn (TestResponse $r) => $r->assertOk()->assertJsonPath('kind', $kind)->assertHeader('Cache-Control', 'no-store, private'));
})->with([
    'Treffen freigeben' => ['event', M417_DECIDE],
    'Betrieb verifizieren' => ['business', M417_DECIDE],
    'Flag umschalten' => ['flag', M417_FLAGS],
]);

it('answers 404 for an unknown kind', function () {
    m417As('owner');

    $this->get('/admin/palette/targets/member')->assertNotFound();
});

it('lists meets in review oldest first, filtered by title, each opening the ADM-53 pane', function () {
    evFlags();
    $older = evEvent(null, ['title' => 'Hafentreffen Kai', 'status' => EventStatus::PendingReview, 'submitted_at' => now()->subHours(5)]);
    $newer = evEvent(null, ['title' => 'Nachtausfahrt Elbe', 'status' => EventStatus::PendingReview, 'submitted_at' => now()->subHour()]);
    evEvent(null, ['title' => 'Schon veröffentlicht', 'status' => EventStatus::Published]);
    m417As('moderator');

    $this->getJson('/admin/palette/targets/event')->assertOk()->assertJsonCount(2, 'items')
        ->assertJsonPath('items.0.id', $older->id)->assertJsonPath('items.0.url', "/admin/events?event={$older->id}")
        ->assertJsonPath('items.1.id', $newer->id);
    $this->getJson('/admin/palette/targets/event?q=Elbe')->assertOk()->assertJsonCount(1, 'items')->assertJsonPath('items.0.title', 'Nachtausfahrt Elbe');
});

it('lists open applications without any e-mail address, each opening the ADM-55 pane', function () {
    bizFlags();
    $owner = User::factory()->create(['username' => 'jana.werkstatt', 'email' => 'jana@example.test']);
    $applied = bizBusiness($owner, ['name' => 'Werkstatt Nord', 'status' => BusinessStatus::Applied, 'verified_at' => null, 'submitted_at' => now()->subHours(3)]);
    bizBusiness(null, ['name' => 'Schon geprüft', 'status' => BusinessStatus::Verified]);
    m417As('admin');

    $response = $this->getJson('/admin/palette/targets/business')->assertOk()->assertJsonCount(1, 'items')
        ->assertJsonPath('items.0.id', $applied->id)->assertJsonPath('items.0.url', "/admin/businesses?business={$applied->id}");
    expect((string) $response->getContent())->toContain('@jana.werkstatt')->not->toContain('jana@example.test');
});

it('finds flags by key, each opening its ADM-36 drawer', function () {
    FeatureFlag::query()->updateOrCreate(['key' => 'events'], ['enabled' => true, 'description' => 'Treffen']);
    FeatureFlag::query()->updateOrCreate(['key' => 'build_comments'], ['enabled' => false, 'description' => 'Kommentare']);
    m417As('owner');

    $this->getJson('/admin/palette/targets/flag?q=comments')->assertOk()->assertJsonCount(1, 'items')
        ->assertJsonPath('items.0.title', 'build_comments')->assertJsonPath('items.0.url', '/admin/config/flags?flag=build_comments');
});

it('puts the review queues on the dashboard for moderation.view only', function () {
    evFlags();
    bizFlags();
    evEvent(null, ['status' => EventStatus::PendingReview, 'submitted_at' => now()->subHours(30)]);
    bizBusiness(null, ['status' => BusinessStatus::Applied, 'verified_at' => null, 'submitted_at' => now()->subHours(2)]);

    m417As('moderator');
    $this->get('/admin')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->where('queues.events_review.count', 1)->where('queues.events_review.status', 'warning')->whereType('queues.events_review.since', 'string')
        ->where('queues.business_applications.count', 1));

    auth('staff')->logout();
    app('auth')->forgetGuards();
    actingAsStaff(staffWithRole('content_editor'));
    $this->get('/admin')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->missing('queues.events_review')->missing('queues.business_applications'));
});

it('loads the ADM-57 brand list and merge candidates on demand, for catalog.manage only', function () {
    seedModSchema();
    $kw = Brand::query()->where('slug', 'kw')->firstOrFail();
    $suspension = ModCategory::query()->where('key', 'suspension')->firstOrFail();
    $product = Product::factory()->create(['brand_id' => $kw->id, 'category_id' => $suspension->id, 'name' => 'Variante 3']);
    $twin = Product::factory()->create(['brand_id' => $kw->id, 'category_id' => $suspension->id, 'name' => 'Variante 3 Doppelt']);
    Product::factory()->create(['brand_id' => $kw->id, 'category_id' => $suspension->id, 'name' => 'Alt', 'status' => ProductStatus::Archived]);

    m417As('content_editor');
    $this->get("/admin/catalog/products/{$product->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->missing('mergeCandidates')->missing('brandChoices')->has('categories')
        ->reloadOnly('mergeCandidates', fn (AssertableInertia $reload) => $reload->has('mergeCandidates', 1)->where('mergeCandidates.0.value', $twin->id)));
    $this->get('/admin/catalog/products')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->missing('brandChoices')->reloadOnly('brandChoices', fn (AssertableInertia $reload) => $reload->where('brandChoices', fn ($brands) => count($brands) > 0)));

    auth('staff')->logout();
    app('auth')->forgetGuards();
    // No seeded role reads the catalogue without managing it: a staff member with the single atom catalog.view.
    $viewer = staffWithRole(null);
    $viewer->givePermissionTo('catalog.view');
    actingAsStaff($viewer);
    $this->get("/admin/catalog/products/{$product->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->reloadOnly('mergeCandidates', fn (AssertableInertia $reload) => $reload->has('mergeCandidates', 0)));
    $this->get('/admin/catalog/products')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->reloadOnly('brandChoices', fn (AssertableInertia $reload) => $reload->has('brandChoices', 0)));
});

it('checks the hash chain of the audit events on one page, for audit.view only', function () {
    seedStaffRoles();
    $owner = staffWithRole('owner');
    Audit::record('staff.login', $owner, actor: $owner);
    Audit::record('member.restricted', null, ['messaging' => null], ['messaging' => '2026-06-21'], 'Spam an neue Mitglieder', $owner);
    $ids = AuditEvent::query()->orderBy('id')->pluck('id')->implode(',');
    $allowed = array_values(array_filter(ADMIN_ROLES, fn (string $role): bool => staffWithRole($role)->can('audit.view')));

    assertAdminMatrix('GET', "/admin/audit/verify-page?ids=$ids", $allowed, fn (TestResponse $r) => $r->assertOk()->assertJsonPath('intact', true)->assertJsonPath('broken', []));

    actingAsStaff($owner);
    $this->getJson("/admin/audit/verify-page?ids=$ids")->assertOk()->assertJsonPath('checked', count(explode(',', $ids)))->assertJsonPath('intact', true);
    $this->getJson('/admin/audit/verify-page?ids=')->assertStatus(422);
    $this->getJson('/admin/audit/verify-page?ids='.implode(',', range(1, 101)))->assertStatus(422);
    $this->getJson('/admin/audit/verify-page?ids=999999')->assertOk()->assertJsonPath('intact', false)->assertJsonPath('missing', 1);
});

it('shows ADM-59 passkeys, linked providers and security events without any secret, e-mail or IP', function () {
    $member = User::factory()->create(['username' => 'tom.sicher']);
    $passkey = MemberPasskey::factory()->create(['user_id' => $member->id, 'name' => 'iPhone von Tom']);
    $google = SocialAccount::factory()->create(['user_id' => $member->id, 'email' => 'tom.provider@example.test']);
    SecurityEvent::factory()->create(['user_id' => $member->id, 'type' => MemberSecurityEvent::PasskeyAdded, 'approx_city' => 'Leipzig']);
    seedStaffRoles();
    $allowed = array_values(array_filter(ADMIN_ROLES, fn (string $role): bool => staffWithRole($role)->can('members.view')));

    assertAdminMatrix('GET', "/admin/members/{$member->id}?tab=security", $allowed, function (TestResponse $r) use ($passkey, $google): void {
        $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('tab', 'security')
            ->where('security.passkeys.0.name', 'iPhone von Tom')->where('security.passkeys.0.synced', true)
            ->where('security.providers.0.provider', 'google')->missing('security.providers.0.email')
            ->where('security.events.0.type', 'member.passkey_added')->where('security.events.0.approx_city', 'Leipzig'));
        expect((string) $r->getContent())->not->toContain($passkey->credential_id)->not->toContain($google->provider_sub)->not->toContain('tom.provider@example.test')->not->toContain('ip_trunc');
    });
});

it('lists ADM-60 comments with their open case, filtered by report and status, for moderation.view', function () {
    s2Flags(['build_comments' => false]);
    $owner = User::factory()->create(['username' => 'jann.ptrs']);
    $update = s2Post(publishedVehicle($owner));
    $author = User::factory()->create(['username' => 'lukas.kommentar']);
    $reported = Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $author->id, 'body' => 'Fahr das Ding lieber auf den Schrottplatz.']);
    Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $owner->id, 'body' => 'Danke, das Fahrwerk ist frisch eingetragen.']);
    $case = ModerationCase::factory()->create(['target_type' => ReportTargetType::Comment, 'target_id' => $reported->id, 'status' => CaseStatus::New]);
    seedStaffRoles();
    $allowed = array_values(array_filter(ADMIN_ROLES, fn (string $role): bool => staffWithRole($role)->can('moderation.view')));

    assertAdminMatrix('GET', '/admin/comments', $allowed, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Comments/Index', false)->where('rows.meta.total', 2)->where('flag.enabled', false)));

    actingAsStaff(staffWithRole('moderator'));
    $this->get('/admin/comments?filter[reported]=1')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->where('rows.meta.total', 1)->where('rows.data.0.id', $reported->id)->where('rows.data.0.case_id', $case->id)
        ->where('rows.data.0.author.username', 'lukas.kommentar')->where('rows.data.0.vehicle_id', $update->vehicle_id)->where('flag.canManage', false));
    $this->get('/admin/comments?filter[q]=@jann')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('rows.meta.total', 1));
    $this->get('/admin/comments?filter[status]=removed')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('rows.meta.total', 0));
});
