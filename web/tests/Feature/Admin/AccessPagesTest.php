<?php

use App\Http\Controllers\Admin\Support\AdminLocale;
use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Route;
use Illuminate\View\View;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Support/helpers.php';

/*
 * ADM-01…05 UI part: shared props (contract §3), the enrolment page ADM-03, the DE/EN preference, the admin error pages.
 */

describe('shared props', function () {
    it('shares nothing about staff to a guest, and the app block', function () {
        $this->get('/admin/login')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('Auth/Login')
                ->where('staff', null)
                ->where('app.env', 'testing')
                ->where('app.locale', 'de')
                ->where('app.idle_minutes', 30)
                ->where('app.warn_minutes', 25)
                ->has('app.version')
                ->where('nav_counts', ['approvals_for_me' => 0, 'alerts' => 0])
                ->has('flash'));
    });

    it('shares the staff member with roles and atoms, and never a secret', function () {
        seedStaffRoles();
        $staff = staffWithRole('analyst');

        actingAsStaff($staff)->get('/admin')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('staff.id', $staff->id)
                ->where('staff.name', $staff->name)
                ->where('staff.email', $staff->email)
                ->where('staff.roles', ['analyst'])
                ->where('staff.permissions', fn ($atoms) => collect($atoms)->sort()->values()->all() === collect(['analytics.view', 'members.view', 'vehicles.view', 'qr.view', 'moderation.view'])->sort()->values()->all())
                ->where('staff.two_factor_confirmed', true)
                ->where('staff.password_confirmed_until', null)
                ->missing('staff.password')
                ->missing('staff.two_factor_secret')
                ->missing('staff.two_factor_recovery_codes'));
    });

    it('shares the end of a recent password confirmation (ADR-215)', function () {
        seedStaffRoles();
        $this->freezeSecond();

        actingAsStaff(staffWithRole('owner'))
            ->withSession(['auth.password_confirmed_at' => now()->getTimestamp() - 60])
            ->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('staff.password_confirmed_until', now()->addSeconds(240)->toIso8601String()));
    });

    it('passes the flash keys of the contract through', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner'))
            ->withSession([
                'success' => 'ui.table.views.saved',
                'approval' => ['id' => '01ABC', 'title' => 'Audit-Export', 'expires_at' => '2026-11-10T12:00:00+00:00'],
                'confirm_password' => true,
            ])
            ->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->where('flash.success', 'ui.table.views.saved')
                ->where('flash.approval.id', '01ABC')
                ->where('flash.confirm_password', true)
                ->missing('flash.error'));
    });
});

describe('ADM-03 enrolment page', function () {
    it('sends a guest to the sign-in', function () {
        $this->get('/admin/two-factor/setup')->assertRedirect('/admin/login');
    });

    it('renders for staff without TOTP, with nothing secret and no-store', function () {
        seedStaffRoles();
        $staff = staffWithRole('owner', totp: false);

        $response = actingAsStaff($staff)->get('/admin/two-factor/setup');

        $response->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page
                ->component('Auth/TwoFactorSetup')
                ->where('passwordConfirmed', false)
                ->missing('qr')
                ->missing('secret')
                ->missing('recovery_codes'));
        expect((string) $response->headers->get('Cache-Control'))->toContain('no-store');
        expect($response->getContent())->not->toContain('otpauth://');
    });

    it('sends enrolled staff to the dashboard', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('owner'))->get('/admin/two-factor/setup')->assertRedirect('/admin');
    });

    it('is the place every other admin page sends an account without TOTP', function () {
        seedStaffRoles();

        actingAsStaff(staffWithRole('support', totp: false))->get('/admin/alerts')->assertRedirect('/admin/two-factor/setup');
    });
});

describe('DE/EN preference', function () {
    it('answers in the language of the sc_admin_lang cookie, signed out and signed in', function () {
        $this->withHeader('Cookie', 'other=1; '.AdminLocale::COOKIE.'=en')->get('/admin/login')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('app.locale', 'en'));

        seedStaffRoles();
        actingAsStaff(staffWithRole('analyst'))->withHeader('Cookie', AdminLocale::COOKIE.'=en')->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('app.locale', 'en'));
    });

    it('ignores any other value and defaults to German', function (string $value) {
        $this->withHeader('Cookie', AdminLocale::COOKIE.'='.$value)->get('/admin/login')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('app.locale', 'de'));
    })->with(['fr', 'EN', 'english', '"><script>', '']);

    it('has no route a guest could call to change it', function () {
        expect(Route::has('admin.preferences.locale'))->toBeFalse();
    });

    it('lets the visual matrix pick the language outside production only', function () {
        $this->get('/admin/login?qaLocale=en')->assertInertia(fn (AssertableInertia $page) => $page->where('app.locale', 'en'));

        app()->detectEnvironment(fn (): string => 'production');
        expect(AdminLocale::resolve(request()->duplicate(['qaLocale' => 'en'])))->toBe('de');
    });
});

describe('ADM-05 error pages', function () {
    it('renders 403 inside the shell for a role without the atom', function () {
        seedStaffRoles();

        assertAdminErrorPage(actingAsStaff(staffWithRole('moderator'))->get('/admin/audit'), 403);
    });

    it('prints Ziggy\'s route declaration in the 403 page, even after another render in the same request', function () {
        seedStaffRoles();

        $html = (string) actingAsStaff(staffWithRole('moderator'))->get('/admin/audit')->assertStatus(403)->getContent();

        expect($html)->toContain('const Ziggy')->not->toContain('Object.assign(Ziggy.routes');
    });

    it('prints Ziggy\'s route declaration in the 404 page of an unknown admin URL', function () {
        seedStaffRoles();

        $html = (string) actingAsStaff(staffWithRole('owner'))->get('/admin/qa-seite-gibt-es-nicht')->assertStatus(404)->getContent();

        expect($html)->toContain('"component":"Error"')->toContain('const Ziggy')->not->toContain('Object.assign(Ziggy.routes');
    });

    it('answers an Inertia visit with the Error page, not raw HTML', function () {
        seedStaffRoles();
        $version = app(HandleInertiaRequests::class)->version(request());

        actingAsStaff(staffWithRole('analyst'))
            ->get('/admin/audit', ['X-Inertia' => 'true', 'X-Inertia-Version' => (string) $version, 'X-Requested-With' => 'XMLHttpRequest'])
            ->assertStatus(403)
            ->assertHeader('X-Inertia', 'true')
            ->assertJsonPath('component', 'Error')
            ->assertJsonPath('props.status', 403)
            ->assertJsonPath('props.staff.roles', ['analyst']);
    });

    it('renders 404 for a record that does not exist inside an admin route', function () {
        seedStaffRoles();

        assertAdminErrorPage(actingAsStaff(staffWithRole('owner'))->delete('/admin/saved-views/01JZZZZZZZZZZZZZZZZZZZZZZZ'), 404);
    });

    it('keeps JSON for a JSON client', function () {
        seedStaffRoles();

        $response = actingAsStaff(staffWithRole('moderator'))->getJson('/admin/audit');

        $response->assertStatus(403);
        expect((string) $response->headers->get('Content-Type'))->toContain('json');
    });

    it('renders a malformed table query as 400, not a server error', function () {
        seedStaffRoles();

        assertAdminErrorPage(actingAsStaff(staffWithRole('owner'))->get('/admin/audit?filter[secret]=1'), 400);
    });

    it('leaves responses outside /admin alone', function () {
        $this->get('/does-not-exist-'.Str::random(6))->assertNotFound()->assertDontSee('"component":"Error"', false);
    });
});

describe('shared props are never replaced by a page (DQ-708)', function () {
    it('keeps the sidebar badges and the shell props on every admin page without route parameters', function () {
        seedStaffRoles();
        $owner = staffWithRole('owner');
        $shared = ['staff', 'app', 'flash', 'nav_counts'];
        $checked = [];
        $collisions = [];

        foreach (Route::getRoutes()->getRoutes() as $route) {
            if (! str_starts_with($route->uri(), 'admin') || ! in_array('GET', $route->methods(), true) || $route->parameterNames() !== []) {
                continue;
            }
            $response = actingAsStaff($owner)->get('/'.$route->uri());
            $view = $response->baseResponse instanceof Response ? $response->baseResponse->getOriginalContent() : null;
            $page = $response->baseResponse->getStatusCode() === 200 && $view instanceof View ? ($view->getData()['page'] ?? null) : null;
            if (! is_array($page)) {
                continue;
            }
            $checked[] = $route->uri();
            $props = $page['props'];
            if (! is_array($props['nav_counts'] ?? null) || array_keys($props['nav_counts']) !== ['approvals_for_me', 'alerts']) {
                $collisions[] = $route->uri().': nav_counts';
            }
            if (! is_array($props['app'] ?? null) || ! array_key_exists('env', $props['app']) || ($props['staff']['id'] ?? null) !== $owner->id) {
                $collisions[] = $route->uri().': app/staff';
            }
        }

        // The ten pages of DQ-708 pass a `counts` of their own: among them the queues, the catalogue and the approvals.
        expect($checked)->toContain('admin/team/approvals', 'admin/moderation/reports', 'admin/support/tickets', 'admin/system/jobs')
            ->and(count($checked))->toBeGreaterThan(30)
            ->and($collisions)->toBe([])
            ->and($shared)->toHaveCount(4);
    });
});
