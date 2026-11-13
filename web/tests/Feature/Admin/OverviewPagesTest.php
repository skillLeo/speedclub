<?php

use App\Enums\CaseStatus;
use App\Enums\StaffStatus;
use App\Models\ModerationCase;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Support/helpers.php';

/*
 * ADM-06 dashboard, ADM-07 search (+ palette suggestions), ADM-08 alerts: authorisation matrix and what each role sees.
 */

describe('authorisation matrix', function () {
    it('opens the dashboard for every role', function () {
        assertAdminMatrix('GET', '/admin', ADMIN_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Dashboard/Index')));
    });

    it('opens the search page for every role', function () {
        assertAdminMatrix('GET', '/admin/search?q=s14', ADMIN_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Search/Index')->where('q', 's14')));
    });

    it('answers palette suggestions for every role', function () {
        assertAdminMatrix('GET', '/admin/search/suggest?q=s14', ADMIN_ROLES, fn (TestResponse $r) => $r->assertOk()->assertJsonStructure(['q', 'groups']));
    });

    it('opens the alerts page for every role', function () {
        assertAdminMatrix('GET', '/admin/alerts', ADMIN_ROLES, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Alerts/Index')));
    });

    it('signs a suspended staff member out', function (string $uri) {
        seedStaffRoles();
        $staff = staffWithRole('owner');
        $staff->forceFill(['status' => StaffStatus::Suspended])->save();

        actingAsStaff($staff)->get($uri)->assertRedirect('/admin/login');
        expect(auth('staff')->check())->toBeFalse();
    })->with(['/admin', '/admin/search', '/admin/alerts', '/admin/audit', '/admin/dev/gallery']);
});

describe('ADM-06 dashboard', function () {
    it('shows the first-run state while there are no members', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner'))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('firstRun', true));

        User::factory()->create();

        actingAsStaff(staffWithRole('owner'))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('firstRun', false));
    });

    it('sends queues with the page and KPIs, charts and DSA deferred', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner'))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('queues')
                ->where('canAnalytics', true)
                ->missing('kpis')
                ->missing('charts')
                ->missing('dsa')
                ->loadDeferredProps(['kpis', 'charts', 'dsa'], fn (AssertableInertia $reload) => $reload
                    ->has('kpis')
                    ->has('charts.registrations')
                    ->has('charts.qr_funnel')
                    ->has('charts.top_makes')
                    ->has('dsa')));
    });

    it('gives each role only the queues of its atoms', function (string $role, array $expected) {
        seedStaffRoles();

        actingAsStaff(staffWithRole($role))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('queues', fn ($queues) => collect($queues)->keys()->sort()->values()->all() === $expected));
    })->with([
        // M3.6: privacy_due (GDPR deadlines ≤ 7 days) for privacy.view. M4.17: the review queues events_review (ADM-53) and
        // business_applications (ADM-55) for moderation.view.
        'owner' => ['owner', ['appeals', 'business_applications', 'events_review', 'failed_jobs', 'privacy_due', 'queue', 'reports', 'scheduler', 'support_tickets']],
        'moderator' => ['moderator', ['appeals', 'business_applications', 'events_review', 'reports', 'support_tickets']],
        'support' => ['support', ['privacy_due', 'support_tickets']],
        'content editor' => ['content_editor', []],
        'analyst' => ['analyst', ['business_applications', 'events_review', 'reports']],
    ]);

    it('counts open cases for the reports queue', function () {
        seedStaffRoles();
        ModerationCase::factory()->count(2)->create(['status' => CaseStatus::New]);
        ModerationCase::factory()->create(['status' => CaseStatus::Decided]);

        actingAsStaff(staffWithRole('moderator'))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('queues.reports.count', 2));
    });

    it('keeps KPIs from roles without analytics.view', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('support'))->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('canAnalytics', false)
                ->loadDeferredProps(['kpis', 'charts', 'dsa'], fn (AssertableInertia $reload) => $reload->where('kpis', [])->where('charts', null)->where('dsa', null)));
    });
});

describe('ADM-07 search', function () {
    it('shows the empty state without a term and cuts long input to 120 characters', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner');

        actingAsStaff($staff)->get('/admin/search')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('q', '')->where('groups', []));

        actingAsStaff($staff)->get('/admin/search?q='.str_repeat('a', 300))
            ->assertInertia(fn (AssertableInertia $page) => $page->where('q', str_repeat('a', 120)));
    });

    it('does not search the palette for a single character and is not cached', function () {
        seedStaffRoles();

        $response = actingAsStaff(staffWithRole('owner'))->getJson('/admin/search/suggest?q=a');

        $response->assertOk()->assertExactJson(['q' => 'a', 'groups' => []]);
        expect((string) $response->headers->get('Cache-Control'))->toContain('no-store');
    });

    it('treats a non-string term as empty', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner'))->getJson('/admin/search/suggest?q[]=x')->assertOk()->assertJsonPath('q', '');
    });
});

describe('ADM-08 alerts', function () {
    it('lists open cases assigned to me, not to others and not decided ones', function () {
        seedStaffRoles();
        $me = staffWithRole('moderator');
        $other = staffWithRole('moderator');
        $mine = ModerationCase::factory()->create(['status' => CaseStatus::InReview, 'assigned_staff_id' => $me->id]);
        ModerationCase::factory()->create(['status' => CaseStatus::New, 'assigned_staff_id' => $other->id]);
        ModerationCase::factory()->create(['status' => CaseStatus::Decided, 'assigned_staff_id' => $me->id]);

        actingAsStaff($me)->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->has('cases', 1)
                ->where('cases.0.id', $mine->id)
                ->where('sections.cases', true)
                ->where('sections.approvals', false)
                ->where('nav_counts.alerts', 1));
    });

    it('shows sections only for the atoms the role holds', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('content_editor'))->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('sections', ['approvals' => false, 'cases' => false, 'warnings' => false])
                ->where('cases', [])
                ->where('approvals', [])
                ->where('warnings', []));
    });

    it('warns audit readers when the last chain check failed', function () {
        seedStaffRoles();
        cache()->forever('audit:last_verification', ['intact' => false, 'checked' => 41, 'broken_at' => 42, 'failure' => 'hash', 'verified_at' => '2026-11-09T02:00:00+00:00']);

        actingAsStaff(staffWithRole('admin'))->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('warnings.0.key', 'audit_chain_broken')->where('warnings.0.tone', 'danger'));

        actingAsStaff(staffWithRole('moderator'))->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('warnings', []));
    });

    it('warns system readers about failed jobs', function () {
        seedStaffRoles();
        DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default', 'payload' => '{}', 'exception' => 'x', 'failed_at' => now()]);

        actingAsStaff(staffWithRole('owner'))->get('/admin/alerts')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('warnings.0.key', 'failed_jobs'));
    });
});
