<?php

use App\Enums\StaffSecurityEvent;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Staff;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

/**
 * ADM-03 "Später einrichten" (STAFF_2FA_REQUIRED=false). The skip marks one session, is audited and never stored on the account; a
 * skipped session reaches the admin, but no step that rests on a current code. With the flag on (the default) nothing changes:
 * StaffAccessHardeningTest pins that behaviour.
 */
function skipAllowed(bool $allowed = true): void
{
    config(['speedclub.staff.two_factor_required' => ! $allowed]);
}

function skippedSession(): array
{
    return [EnsureStaffTwoFactor::SKIPPED => true, EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE => true];
}

function skipRows(): int
{
    return AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorSkipped->value)->count();
}

describe('with STAFF_2FA_REQUIRED on (default)', function () {
    it('defaults to required', function () {
        expect(config('speedclub.staff.two_factor_required'))->toBeTrue()
            ->and(EnsureStaffTwoFactor::skippable())->toBeFalse();
    });

    it('offers no skip on ADM-03', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->get('/admin/two-factor/setup')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/TwoFactorSetup')->where('skippable', false));
    });

    it('sends the skip back to enrolment and marks nothing', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->post('/admin/two-factor/skip')
            ->assertRedirect('/admin/two-factor/setup')
            ->assertStatus(303);

        expect(session()->has(EnsureStaffTwoFactor::SKIPPED))->toBeFalse()
            ->and(skipRows())->toBe(0);
    });

    it('ignores an old skip mark', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->withSession(skippedSession())
            ->get('/admin')
            ->assertRedirect('/admin/two-factor/setup');
    });
});

describe('with STAFF_2FA_REQUIRED off', function () {
    beforeEach(fn () => skipAllowed());

    it('offers the skip on ADM-03', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->get('/admin/two-factor/setup')
            ->assertOk()
            ->assertInertia(fn (AssertableInertia $page) => $page->component('Auth/TwoFactorSetup')->where('skippable', true));
    });

    it('still sends a session that did not skip to enrolment', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')
            ->get('/admin')
            ->assertRedirect('/admin/two-factor/setup');
    });

    it('marks this session, writes the audit row and goes to the dashboard', function () {
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')
            ->withSession([EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE => true])
            ->post('/admin/two-factor/skip')
            ->assertStatus(303)
            ->assertRedirect('/admin');

        $row = AuditEvent::query()->where('action', StaffSecurityEvent::TwoFactorSkipped->value)->sole();

        expect(session(EnsureStaffTwoFactor::SKIPPED))->toBeTrue()
            ->and($row->target_id)->toBe((string) $staff->getKey())
            ->and($staff->fresh()?->two_factor_confirmed_at)->toBeNull()
            ->and($staff->fresh()?->two_factor_secret)->toBeNull();

        $this->get('/admin')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Dashboard/Index'));
    });

    it('lists every admin route for the shell of a skipped session, so the sidebar is not empty', function () {
        $html = (string) $this->actingAs(Staff::factory()->create(), 'staff')
            ->withSession(skippedSession())
            ->get('/admin')
            ->assertOk()
            ->getContent();

        expect($html)->toContain('"admin.dashboard"')->toContain('"admin.members.index"');
    });

    it('keeps the guest route list for a session that did not skip', function () {
        $html = (string) $this->actingAs(Staff::factory()->create(), 'staff')
            ->get('/admin/two-factor/setup')
            ->assertOk()
            ->getContent();

        expect($html)->toContain('Ziggy')->not->toContain('"admin.members.index"');
    });

    it('audits a repeated skip of the same session once', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')->withSession(skippedSession())->post('/admin/two-factor/skip')->assertRedirect('/admin');

        expect(skipRows())->toBe(0);
    });

    it('also accepts a skip during a started enrolment', function () {
        $staff = Staff::factory()->create(['two_factor_secret' => encrypt('ABCDEFGHABCDEFGHABCDEFGHABCDEFGH'), 'two_factor_confirmed_at' => null]);

        $this->actingAs($staff, 'staff')->post('/admin/two-factor/skip')->assertRedirect('/admin');

        expect(skipRows())->toBe(1);
    });

    it('refuses the skip to staff with confirmed TOTP', function () {
        $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')
            ->postJson('/admin/two-factor/skip')
            ->assertForbidden();

        expect(skipRows())->toBe(0);
    });

    it('sends guests to the sign-in', function () {
        $this->post('/admin/two-factor/skip')->assertRedirect('/admin/login');
        $this->postJson('/admin/two-factor/skip')->assertUnauthorized();

        expect(skipRows())->toBe(0);
    });

    it('limits skips per account', function () {
        $staff = Staff::factory()->create();
        config(['speedclub.staff.two_factor_skips_per_minute' => 2]);

        $this->actingAs($staff, 'staff')->post('/admin/two-factor/skip')->assertRedirect('/admin');
        $this->actingAs($staff, 'staff')->post('/admin/two-factor/skip')->assertRedirect('/admin');
        $this->actingAs($staff, 'staff')->post('/admin/two-factor/skip')->assertStatus(429);
    });

    it('still ends a skipped session once TOTP is confirmed elsewhere', function () {
        $staff = Staff::factory()->create();

        $this->postJson('/admin/login', ['email' => $staff->email, 'password' => 'password-for-tests'])->assertOk()->assertJson(['two_factor' => false]);
        app('auth')->forgetGuards();
        $this->post('/admin/two-factor/skip')->assertRedirect('/admin');
        app('auth')->forgetGuards();
        $this->getJson('/admin')->assertOk();

        Staff::query()->whereKey($staff->getKey())->sole()->forceFill([
            'two_factor_secret' => encrypt('ABCDEFGHABCDEFGHABCDEFGHABCDEFGH'),
            'two_factor_recovery_codes' => encrypt((string) json_encode(['aaaaaaaaaa-bbbbbbbbbb'])),
            'two_factor_confirmed_at' => now(),
        ])->save();
        app('auth')->forgetGuards();

        $this->getJson('/admin')->assertUnauthorized();

        expect(AuditEvent::query()->where('action', StaffSecurityEvent::SessionEndedWithoutCode->value)->count())->toBe(1)
            ->and(skipRows())->toBe(1);
    });

    it('keeps the pending-secret rule for a skipped session', function () {
        $staff = Staff::factory()->create(['two_factor_secret' => encrypt('ABCDEFGHABCDEFGHABCDEFGHABCDEFGH'), 'two_factor_confirmed_at' => null]);

        $this->actingAs($staff, 'staff')->withSession(skippedSession())
            ->getJson('/admin/user/two-factor-secret-key')
            ->assertStatus(409)
            ->assertJsonPath('code', 'conflict');
    });

    it('closes the steps that rest on a current code, with the reason', function (string $method, string $uri) {
        $staff = Staff::factory()->create();
        $before = $staff->password;

        $this->actingAs($staff, 'staff')
            ->withSession([...skippedSession(), 'auth.password_confirmed_at' => time()])
            ->json($method, $uri, [
                'code' => '123456',
                'current_password' => 'password-for-tests',
                'password' => 'a-new-staff-password-1',
                'password_confirmation' => 'a-new-staff-password-1',
            ])
            ->assertStatus(409)
            ->assertJsonPath('code', 'two_factor_required')
            ->assertJsonPath('message', __('staff_auth.two_factor_first'))
            ->assertJsonPath('enrolment_url', url('/admin/two-factor/setup'));

        expect($staff->fresh()?->password)->toBe($before);
    })->with([
        'password change' => ['PUT', '/admin/user/password'],
        'recovery codes (Fortify)' => ['GET', '/admin/user/two-factor-recovery-codes'],
        'new recovery codes (Fortify)' => ['POST', '/admin/user/two-factor-recovery-codes'],
        'disable two-factor' => ['DELETE', '/admin/user/two-factor-authentication'],
        'ADM-51 rotation' => ['POST', '/admin/account/two-factor/rotation'],
        'ADM-51 rotation confirm' => ['POST', '/admin/account/two-factor/rotation/confirm'],
        'ADM-51 recovery codes' => ['POST', '/admin/account/recovery-codes'],
        'ADM-51 new recovery codes' => ['POST', '/admin/account/recovery-codes/regenerate'],
    ]);

    it('refuses four-eyes decisions to a skipped session, even for an owner', function (string $decision) {
        seedStaffRoles();
        $owner = staffWithRole('owner', totp: false);
        $approval = ApprovalRequest::factory()->create();

        $this->actingAs($owner, 'staff')
            ->withSession([...skippedSession(), 'auth.password_confirmed_at' => time()])
            ->postJson("/admin/team/approvals/{$approval->getKey()}/{$decision}", ['reason' => 'Geprüft und in Ordnung'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'two_factor_required');

        // An Inertia write stays on its page with the toast.
        $this->from('/admin/team/approvals')
            ->post("/admin/team/approvals/{$approval->getKey()}/{$decision}", ['reason' => 'Geprüft und in Ordnung'], ['X-Inertia' => 'true'])
            ->assertStatus(303)
            ->assertRedirect('/admin/team/approvals')
            ->assertSessionHas('error', 'shell.two_factor.required_for_action');

        expect($approval->fresh()?->status)->toBe($approval->status)
            ->and($approval->fresh()?->decided_by)->toBeNull();
    })->with(['approve', 'deny']);

    it('names only existing routes as closed', function () {
        expect(collect(EnsureStaffTwoFactor::CLOSED_UNTIL_CONFIRMED)->reject(fn (string $name): bool => Route::has($name))->all())->toBe([])
            ->and(Route::has(EnsureStaffTwoFactor::SKIP_ROUTE))->toBeTrue();
    });
});

describe('reminder banner prop', function () {
    it('is on for a skipped session', function () {
        skipAllowed();
        $staff = Staff::factory()->create();

        $this->actingAs($staff, 'staff')->withSession(skippedSession())->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('staff.two_factor_skipped', true));
    });

    it('is off once TOTP is confirmed', function () {
        skipAllowed();

        // An old mark after enrolment in this session (the code was shown, so no SIGNED_IN_WITHOUT_CODE): no banner.
        $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')->withSession([EnsureStaffTwoFactor::SKIPPED => true])->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('staff.two_factor_skipped', false));
    });

    it('is off while TOTP is required', function () {
        $this->actingAs(Staff::factory()->twoFactorConfirmed()->create(), 'staff')->get('/admin')
            ->assertInertia(fn (AssertableInertia $page) => $page->where('staff.two_factor_skipped', false));
    });
});
