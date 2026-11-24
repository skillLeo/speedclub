<?php

use App\Actions\Admin\Overview\SavedViews;
use App\Enums\ApprovalStatus;
use App\Enums\CaseStatus;
use App\Enums\EventStatus;
use App\Enums\Visibility;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\FeatureFlag;
use App\Models\Make;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Businesses/BusinessTestHelpers.php';
require_once __DIR__.'/../../Events/EventTestHelpers.php';

/**
 * M4.17 part 2 (09 §10.2, §10.3, §8.19): ADM-58 Editorial & Beispiele (role matrix, hide/show per item with reason and audit, the flag
 * through UpdateFeatureFlag with four-eyes for a critical flag in production, no direct POST around either), the six dashboard tiles,
 * the ADM-20 SplitQueue pane (selected case, take + 5-s undo) and saved views shared per role.
 */
const M417B_CONTENT_VIEW = ['owner', 'admin', 'content_editor'];
const M417B_DECIDE = ['owner', 'admin', 'moderator'];

function m417bAs(string $role, bool $recent = true): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);

    if ($recent) {
        test()->withSession(['auth.password_confirmed_at' => time()]);
    }

    return $staff;
}

function m417bReason(): string
{
    return 'Beispiel passt nicht zur Kampagne dieser Woche.';
}

function m417bSampleVehicle(array $attributes = []): Vehicle
{
    return Vehicle::factory()->published()->create(['is_sample' => true, 'visibility' => Visibility::Public, ...$attributes]);
}

describe('ADM-58 Editorial & Beispiele', function () {
    it('opens for content.view only', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'x']);

        assertAdminMatrix('GET', '/admin/editorial', M417B_CONTENT_VIEW, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Editorial/Index')));
    });

    it('names the make and the year on the second line of a sample build (DQ-1204)', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'x']);
        $make = Make::factory()->create(['name' => 'BMW']);
        $sample = m417bSampleVehicle(['make_id' => $make->id, 'model_year' => 2021, 'nickname' => null]);
        m417bAs('content_editor');

        $this->get('/admin/editorial')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->where('rows.data.0.id', $sample->id)->where('rows.data.0.caption', 'BMW · 2021'));
    });

    it('lists only sample items with their state, the flag per environment and the inventory', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'x']);
        $sample = m417bSampleVehicle();
        $editorial = User::factory()->create(['is_sample' => true, 'is_editorial' => true, 'username' => 'speedclub.editorial']);
        $owned = Vehicle::factory()->published()->create(['owner_id' => $editorial->id]);
        Vehicle::factory()->published()->create();
        m417bAs('content_editor');

        $this->get('/admin/editorial')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Editorial/Index')
            ->where('tab', 'vehicle')
            ->where('rows.meta.total', 2)
            ->where('rows.data', fn ($rows) => collect($rows)->pluck('id')->sort()->values()->all() === collect([$sample->id, $owned->id])->sort()->values()->all())
            ->where('rows.data.0.state', 'shown')
            ->where('flag.enabled', true)
            ->where('summary.vehicles', 2)
            ->where('summary.members', 1)
            ->where('editorial.username', 'speedclub.editorial')
            ->where('canEdit', true)
            ->where('canToggle', false));
    });

    it('hides a sample build (private, record, audit) and shows it again with its visibility', function () {
        $vehicle = m417bSampleVehicle(['visibility' => Visibility::Unlisted]);
        $staff = m417bAs('content_editor');

        $this->post("/admin/editorial/items/{$vehicle->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()])->assertRedirect()->assertSessionHas('success', 'editorial.flash.hidden');

        expect($vehicle->fresh()->visibility)->toBe(Visibility::Private)
            ->and(DB::table('sample_hidden_items')->where('subject_id', $vehicle->id)->whereNull('restored_at')->count())->toBe(1);
        $audit = AuditEvent::query()->where('action', 'editorial.sample_hidden')->latest('id')->first();
        expect($audit?->reason)->toBe(m417bReason())
            ->and($audit?->actor_id)->toBe((string) $staff->id)
            ->and($audit?->before)->toBe(['visibility' => 'unlisted']);

        $this->get('/admin/editorial?filter[state]=hidden')->assertInertia(fn (AssertableInertia $page) => $page->where('rows.meta.total', 1)->where('rows.data.0.state', 'hidden')->where('rows.data.0.hidden.reason', m417bReason()));

        $this->post("/admin/editorial/items/{$vehicle->id}/show", ['type' => 'vehicle', 'reason' => m417bReason()])->assertSessionHas('success', 'editorial.flash.shown');

        expect($vehicle->fresh()->visibility)->toBe(Visibility::Unlisted)
            ->and(DB::table('sample_hidden_items')->where('subject_id', $vehicle->id)->whereNull('restored_at')->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'editorial.sample_shown')->exists())->toBeTrue();
    });

    it('hides a sample meet and a sample business with removed_at', function () {
        evFlags();
        $event = evEvent(evOrganiser(['is_sample' => true]), ['status' => EventStatus::Published]);
        $business = bizBusiness(null, ['is_sample' => true]);
        m417bAs('admin');

        $this->post("/admin/editorial/items/{$event->id}/hide", ['type' => 'event', 'reason' => m417bReason()])->assertSessionHasNoErrors();
        $this->post("/admin/editorial/items/{$business->id}/hide", ['type' => 'business', 'reason' => m417bReason()])->assertSessionHasNoErrors();

        expect($event->fresh()->removed_at)->not->toBeNull()
            ->and($business->fresh()->removed_at)->not->toBeNull();

        $this->post("/admin/editorial/items/{$event->id}/show", ['type' => 'event', 'reason' => m417bReason()]);
        expect($event->fresh()->removed_at)->toBeNull();
    });

    it('never touches a real member\'s build, and refuses a second hide', function () {
        $real = Vehicle::factory()->published()->create(['visibility' => Visibility::Public]);
        $sample = m417bSampleVehicle();
        m417bAs('content_editor');

        $this->post("/admin/editorial/items/{$real->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()])->assertSessionHasErrors(['state' => 'editorial.errors.not_sample']);
        expect($real->fresh()->visibility)->toBe(Visibility::Public);

        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()]);
        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()])->assertSessionHasErrors(['state' => 'editorial.errors.already_hidden']);
    });

    it('does not restore an item that changed since the hide, but closes the record', function () {
        $sample = m417bSampleVehicle();
        m417bAs('content_editor');
        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()]);
        Vehicle::query()->whereKey($sample->id)->update(['visibility' => Visibility::Public->value]);

        $this->post("/admin/editorial/items/{$sample->id}/show", ['type' => 'vehicle', 'reason' => m417bReason()])->assertSessionHas('error', 'editorial.flash.changed');

        expect(DB::table('sample_hidden_items')->whereNull('restored_at')->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'editorial.sample_shown')->latest('id')->first()?->after['restored'] ?? null)->toBeFalse();
    });

    it('needs a reason, content.edit and a recent password for hide and show', function () {
        $sample = m417bSampleVehicle();

        m417bAs('content_editor');
        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => str_repeat('x', 1001)])->assertSessionHasErrors('reason'); // ADR-540: optional, at most 1000
        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'boat', 'reason' => m417bReason()])->assertSessionHasErrors('type');

        foreach (['moderator', 'support', 'analyst'] as $role) {
            app('auth')->forgetGuards();
            m417bAs($role);
            $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()])->assertForbidden();
        }

        app('auth')->forgetGuards();
        $this->flushSession();
        m417bAs('content_editor', recent: false);
        $this->post("/admin/editorial/items/{$sample->id}/hide", ['type' => 'vehicle', 'reason' => m417bReason()]);
        expect($sample->fresh()->visibility)->toBe(Visibility::Public);
    });

    it('switches the flag of this environment through UpdateFeatureFlag, flags.manage only', function () {
        $flag = FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'x']);

        m417bAs('content_editor');
        $this->post('/admin/editorial/flag', ['enabled' => false, 'reason' => m417bReason()])->assertForbidden();

        app('auth')->forgetGuards();
        m417bAs('admin');
        $this->post('/admin/editorial/flag', ['enabled' => false, 'reason' => m417bReason()])->assertSessionHas('success', 'editorial.flash.flag');

        expect($flag->fresh()->enabled)->toBeFalse()
            ->and(AuditEvent::query()->where('action', 'flag.changed')->exists())->toBeTrue();
    });

    it('makes the flag change four-eyes for a critical flag in production; the direct POST only creates the approval', function () {
        $flag = FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => false, 'description' => 'x', 'rules' => ['critical' => true]]);
        m417bAs('owner');
        app()['env'] = 'production';
        // Outside `testing` the CSRF check runs, so the post carries the session's token like the page does.
        $this->withSession(['_token' => 'm417b-token', 'auth.password_confirmed_at' => time()]);

        $this->post('/admin/editorial/flag', ['enabled' => true, 'reason' => m417bReason(), '_token' => 'm417b-token'])->assertSessionHas('approval');

        expect($flag->fresh()->enabled)->toBeFalse()
            ->and(ApprovalRequest::query()->where('action', 'flags.critical_change')->where('status', ApprovalStatus::Pending)->count())->toBe(1);
    });
});

describe('dashboard KPIs (09 §10.2)', function () {
    it('sends the six tiles to analytics.view, cached', function () {
        User::factory()->create();
        m417bAs('analyst');

        $this->get('/admin')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard/Index')
            ->loadDeferredProps('kpis', fn (AssertableInertia $reload) => $reload
                ->where('kpis', fn ($kpis) => collect($kpis)->pluck('key')->all() === ['members_7d', 'active_builds', 'qr_scans_7d', 'open_reports', 'median_decision', 'push_opt_in'])));
    });
});

describe('ADM-20 SplitQueue', function () {
    it('opens a case in the pane with what a decision needs, and none for an unknown id', function () {
        $case = ModerationCase::factory()->create();
        m417bAs('moderator');

        $this->get("/admin/moderation/reports?case={$case->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Moderation/Reports')
            ->where('selected.case.id', $case->id)
            ->has('selected.composer.actions')
            ->has('selected.reports')
            ->where('selected.messageCase', false));

        $this->get('/admin/moderation/reports?case=01JZZZZZZZZZZZZZZZZZZZZZZZ')->assertInertia(fn (AssertableInertia $page) => $page->where('selected', null));
    });

    it('undoes a take within the window, only for the taker, and audits it', function () {
        $case = ModerationCase::factory()->create();
        $staff = m417bAs('moderator');

        $this->post("/admin/moderation/cases/{$case->id}/assign")->assertSessionHas('moderation.taken.id', $case->id);
        expect($case->fresh()->assigned_staff_id)->toBe($staff->id)->and($case->fresh()->status)->toBe(CaseStatus::InReview);

        $this->post("/admin/moderation/cases/{$case->id}/release")->assertSessionHas('success', 'moderation.flash.released');

        expect($case->fresh()->assigned_staff_id)->toBeNull()
            ->and($case->fresh()->status)->toBe(CaseStatus::New)
            ->and(AuditEvent::query()->where('action', 'moderation.case_released')->exists())->toBeTrue();

        // A second undo, or one without a take in this session, changes nothing.
        $this->post("/admin/moderation/cases/{$case->id}/release")->assertSessionHas('error', 'moderation.flash.undo_expired');
    });

    it('refuses the undo after the window and for a role without moderation.decide', function () {
        $case = ModerationCase::factory()->create();
        m417bAs('moderator');
        $this->post("/admin/moderation/cases/{$case->id}/assign");
        $this->travel(11)->seconds();

        $this->post("/admin/moderation/cases/{$case->id}/release")->assertSessionHas('error', 'moderation.flash.undo_expired');
        expect($case->fresh()->assigned_staff_id)->not->toBeNull();

        app('auth')->forgetGuards();
        m417bAs('analyst');
        $this->post("/admin/moderation/cases/{$case->id}/release")->assertForbidden();
    });

    it('flashes the decided case for the toast and auto-advance', function () {
        $case = ModerationCase::factory()->create();
        m417bAs('moderator');

        $this->post("/admin/moderation/cases/{$case->id}/decide", ['action' => 'no_action', 'reason' => 'Kein Verstoß nach Prüfung der Fotos.'])
            ->assertSessionHas('moderation.decided.id', $case->id)
            ->assertSessionHas('moderation.decided.outcome', 'no_action');
    });
});

describe('saved views shared per role (09 §10.2)', function () {
    it('shows a shared view to the same role only, read-only for them', function () {
        seedStaffRoles();
        $author = staffWithRole('moderator');
        $colleague = staffWithRole('moderator');
        $support = staffWithRole('support');

        actingAsStaff($author);
        $this->post('/admin/saved-views', ['table' => 'moderation-new', 'name' => 'Spam-Welle', 'shared' => true, 'query' => ['filter' => ['reason' => 'spam']]])->assertSessionHas('success');
        $this->post('/admin/saved-views', ['table' => 'moderation-new', 'name' => 'Nur ich', 'query' => ['filter' => ['assigned' => 'me']]]);
        $id = DB::table('admin_saved_views')->where('name', 'Spam-Welle')->value('id');
        expect(DB::table('admin_saved_views')->where('id', $id)->value('shared_role'))->toBe('moderator');

        app('auth')->forgetGuards();
        actingAsStaff($colleague);
        $this->get('/admin/moderation/reports')->assertInertia(fn (AssertableInertia $page) => $page
            ->where('views', fn ($views) => collect($views)->pluck('name')->all() === ['Spam-Welle'])
            ->where('views.0.mine', false)
            ->where('views.0.author', $author->name));
        $this->delete("/admin/saved-views/{$id}")->assertNotFound();

        app('auth')->forgetGuards();
        actingAsStaff($support);
        expect(collect(SavedViews::for($support, 'moderation-new'))->pluck('name')->all())->toBe([]);
    });
});
