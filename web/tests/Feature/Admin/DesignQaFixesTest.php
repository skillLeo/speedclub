<?php

use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Tighten\Ziggy\BladeRouteGenerator;

require_once __DIR__.'/Support/helpers.php';

/*
 * Server side of the M3.1 design-QA fixes (docs/reports/design-qa/phase-3/2026-11-09-M3.1.md).
 */

describe('DQ-507 unknown admin URLs', function () {
    it('renders the 404 with the signed-in staff member from the real session cookie', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner');
        $session = databaseSessionFor($staff, 'staff');

        $this->withCookie(config()->string('speedclub.staff.session_cookie'), $session)
            ->get('/admin/qa-seite-gibt-es-nicht/tief')
            ->assertStatus(404)
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Error')->where('status', 404)->where('staff.id', $staff->id));
    });

    it('still answers a guest with the signed-out 404', function () {
        $this->get('/admin/qa-seite-gibt-es-nicht')
            ->assertStatus(404)
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Error')->where('status', 404)->where('staff', null));
    });
});

describe('DQ-502 sample enrolment steps', function () {
    it('gives the setup page a made-up key and codes for ?qaStep outside production', function (string $step) {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner', totp: false))->get('/admin/two-factor/setup?qaStep='.$step)
            ->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('Auth/TwoFactorSetup')
                ->where('qaSample.step', $step)
                ->where('qaSample.key', 'SAMPLEKEYNOTREALSAMPLEKEYNOTREAL')
                ->has('qaSample.codes', 8)
                ->where('qaSample.codes.0', 'BEISPIEL01-NICHTECHT'));
    })->with(['scan', 'recovery']);

    it('never enables two-factor for the sample', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner', totp: false);

        actingAsStaff($staff)->get('/admin/two-factor/setup?qaStep=scan')->assertOk();

        expect($staff->fresh()?->two_factor_secret)->toBeNull();
    });

    it('has no sample in production or without ?qaStep', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner', totp: false);

        actingAsStaff($staff)->get('/admin/two-factor/setup')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('qaSample', null));

        app()->detectEnvironment(fn (): string => 'production');
        $response = actingAsStaff($staff)->get('/admin/two-factor/setup?qaStep=recovery');
        app()->detectEnvironment(fn (): string => 'testing');

        /** @var TestResponse $response */
        expect((string) $response->getContent())->not->toContain('NICHTECHT')->not->toContain('SAMPLEKEY');
    });
});

describe('SEC-P3-04 the page source of guests lists no admin routes', function () {
    it('gives the sign-in page and an unknown URL only the guest routes', function (string $uri) {
        // One PHP process serves many test requests; a real request starts with a fresh generator.
        BladeRouteGenerator::$generated = false;
        $html = (string) $this->get($uri)->getContent();

        expect($html)->toContain('const Ziggy')
            ->not->toContain('admin.members.index')
            ->not->toContain('admin.audit.index')
            ->not->toContain('admin.dashboard')
            ->not->toContain('admin.team.approvals');
    })->with(['/admin/login', '/admin/qa-seite-gibt-es-nicht']);

    it('lists the admin routes once a staff member with TOTP is signed in', function () {
        seedStaffRoles();

        BladeRouteGenerator::$generated = false;
        $html = (string) actingAsStaff(staffWithRole('owner'))->get('/admin/alerts')->getContent();

        expect($html)->toContain('admin.members.index')->toContain('admin.audit.index');
    });

    it('keeps the bare 404 for a client outside the IP allow-list', function () {
        config(['speedclub.staff.ip_allowlist' => ['192.0.2.10']]);

        $response = $this->get('/admin/qa-seite-gibt-es-nicht');

        $response->assertStatus(404);
        expect((string) $response->getContent())->toBe('')->not->toContain('Ziggy');
    });
});

describe('ADM-03 an abandoned enrolment starts over', function () {
    it('replaces an unconfirmed key with force=true, as the setup page sends it', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner', totp: false);

        actingAsStaff($staff)->withSession(['auth.password_confirmed_at' => time()])->postJson('/admin/user/two-factor-authentication')->assertOk();
        $first = $staff->fresh()?->two_factor_secret;

        // A new sign-in later: the page asks again, with force.
        actingAsStaff($staff)->withSession(['auth.password_confirmed_at' => time()])->postJson('/admin/user/two-factor-authentication', ['force' => true])->assertOk();

        expect($staff->fresh()?->two_factor_secret)->not->toBeNull()->not->toBe($first);
    });
});

describe('the approval flash', function () {
    it('carries the summary the ApprovalNotice reads (id, title key, expiry), never the request model', function () {
        seedStaffRoles();
        $this->withSession(['auth.password_confirmed_at' => time()]);

        $owner = staffWithRole('owner');
        actingAsStaff($owner)->from('/admin/audit')
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Anfrage der Datenschutzbehörde vom 03.11.'])
            ->assertStatus(303)
            ->assertSessionHas('approval', fn (array $flash): bool => array_keys($flash) === ['id', 'title', 'expires_at', 'existing'] && $flash['title'] === 'approvals.audit_export.title' && $flash['existing'] === false);

        // The same request of the same staff member again is the pending one (review N-1): the notice says it waits already.
        actingAsStaff($owner)->from('/admin/audit')
            ->post('/admin/audit/export', ['format' => 'csv', 'reason' => 'Anfrage der Datenschutzbehörde vom 03.11.'])
            ->assertStatus(303)
            ->assertSessionHas('approval', fn (array $flash): bool => $flash['existing'] === true);
    });
});
