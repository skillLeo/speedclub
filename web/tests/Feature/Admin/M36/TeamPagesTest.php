<?php

use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Mail\StaffInviteMail;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\StaffInvitation;
use App\Services\Approvals\Approvals;
use App\Services\Team\StaffInvites;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-39/40 and the invite page (m3.6-contract §1/§2/§3), lane a: the six-role matrix of every page and write, the four-eyes steps that
 * a direct POST only asks for (nothing changes), the Owner rules over HTTP, recent-password refusals, the invite link (single use,
 * expiry, rate limit).
 */
beforeEach(fn () => Mail::fake());

describe('authorisation matrix', function () {
    it('guards the Team pages by staff.view', function (string $uri, string $component) {
        $target = adm36Staff('support');
        assertAdminMatrix('GET', str_replace('{staff}', (string) $target->id, $uri), ADM36_OWNER_ADMIN, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component($component)));
    })->with([
        'ADM-39' => ['/admin/team', 'Team/Index'],
        'ADM-40' => ['/admin/team/{staff}', 'Team/Show'],
        'ADM-41' => ['/admin/team/roles', 'Team/Roles'],
        'ADM-42' => ['/admin/team/permissions', 'Team/Permissions'],
    ]);

    it('guards every staff write by its atom', function (string $method, string $uri, array $data) {
        $target = adm36Staff('analyst');
        adm32WriteMatrix($method, str_replace('{staff}', (string) $target->id, $uri), ADM36_OWNER_ADMIN, $data);
    })->with([
        'invite' => ['POST', '/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'jana.matrix@speedclub.test', 'roles' => ['analyst'], 'locale' => 'de']],
        'resend' => ['POST', '/admin/team/{staff}/resend-invite', []],
        'roles' => ['PATCH', '/admin/team/{staff}/roles', ['roles' => ['support']]],
        'deactivate' => ['POST', '/admin/team/{staff}/deactivate', ['reason' => 'Verlässt das Team zum Monatsende.']],
        'reactivate' => ['POST', '/admin/team/{staff}/reactivate', ['reason' => 'Kommt aus der Elternzeit zurück.']],
        'delete' => ['POST', '/admin/team/{staff}/delete', ['reason' => 'Konto wird nicht mehr gebraucht.']],
        'revoke sessions' => ['POST', '/admin/team/{staff}/revoke-sessions', ['reason' => 'Laptop verloren, alle Sitzungen beenden.']],
        'reset 2FA' => ['POST', '/admin/team/{staff}/reset-two-factor', ['reason' => 'Telefon mit Authenticator verloren.']],
    ]);

    it('asks for a recent password before every staff step and changes nothing without it', function (string $method, string $uri, array $data) {
        $target = adm36Staff('analyst');
        adm36As('owner');
        adm36StalePassword();

        $this->call($method, str_replace('{staff}', (string) $target->id, $uri), $data)->assertRedirect()->assertSessionHas('confirm_password', true);

        expect(adm36Roles($target))->toBe(['analyst'])
            ->and($target->fresh()->status)->toBe(StaffStatus::Active)
            ->and(Staff::query()->where('email', 'jana.stale@speedclub.test')->exists())->toBeFalse()
            ->and(ApprovalRequest::query()->count())->toBe(0);
    })->with([
        'invite' => ['POST', '/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'jana.stale@speedclub.test', 'roles' => ['analyst'], 'locale' => 'de']],
        'roles' => ['PATCH', '/admin/team/{staff}/roles', ['roles' => ['support']]],
        'deactivate' => ['POST', '/admin/team/{staff}/deactivate', ['reason' => 'Verlässt das Team zum Monatsende.']],
        'revoke sessions' => ['POST', '/admin/team/{staff}/revoke-sessions', ['reason' => 'Laptop verloren, alle Sitzungen beenden.']],
        'reset 2FA' => ['POST', '/admin/team/{staff}/reset-two-factor', ['reason' => 'Telefon mit Authenticator verloren.']],
    ]);
});

describe('ADM-39 staff list', function () {
    it('lists staff with roles and state, never a password or key, and filters by state', function () {
        $viewer = adm36As('admin');
        adm36Staff('support', ['name' => 'Lena Hoffmann']);
        adm36Staff('analyst', ['name' => 'Tim Becker', 'password_proof_required' => true]);
        adm36Staff('moderator', ['name' => 'Alt Konto', 'status' => StaffStatus::Deactivated]);

        $response = $this->get('/admin/team')->assertOk();
        $response->assertInertia(fn (AssertableInertia $p) => $p->component('Team/Index')
            ->where('viewerIsOwner', false)
            ->has('roles', fn (AssertableInertia $roles) => $roles->each(fn (AssertableInertia $role) => $role->hasAll(['name', 'description', 'atoms', 'sensitive', 'locked'])))
            ->where('rows.data', fn ($rows) => collect($rows)->contains(fn ($row) => $row['name'] === 'Tim Becker' && $row['state'] === 'invited')
                && collect($rows)->contains(fn ($row) => $row['name'] === 'Lena Hoffmann' && $row['roles'] === ['support'] && $row['state'] === 'active')
                && collect($rows)->contains(fn ($row) => $row['id'] === $viewer->id && $row['me'] === true)));

        expect(adm36PropsJson($response))->not->toContain('two_factor_secret')->not->toContain('password":');

        $this->get('/admin/team?filter[state]=deactivated')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data', fn ($rows) => collect($rows)->pluck('name')->all() === ['Alt Konto']));
    });

    it('invites with plain roles at once and mails the 72-hour link', function () {
        adm36As('admin');

        $this->post('/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'Jana.Wolff@speedclub.test', 'roles' => ['support'], 'locale' => 'de'])
            ->assertRedirect()->assertSessionHas('success', 'team.flash.invited')->assertSessionMissing('approval');

        $staff = Staff::query()->where('email', 'jana.wolff@speedclub.test')->sole();
        expect(adm36Roles($staff))->toBe(['support'])
            ->and($staff->password_proof_required)->toBeTrue()
            ->and(StaffInvitation::query()->where('staff_id', $staff->id)->sole()->expires_at->diffInHours(now(), true))->toBeGreaterThan(71.9);
        Mail::assertSent(StaffInviteMail::class, fn (StaffInviteMail $mail) => str_contains($mail->link, '/admin/invite#token='));
    });

    it('invites an Admin only through an approval: the account starts with the plain roles (A4)', function () {
        adm36As('admin');

        $this->post('/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'jana.admin@speedclub.test', 'roles' => ['admin'], 'locale' => 'de'])
            ->assertSessionHasErrors();

        $this->post('/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'jana.admin@speedclub.test', 'roles' => ['admin', 'support'], 'locale' => 'de', 'reason' => adm36Reason()])
            ->assertSessionHas('approval')->assertSessionHas('success', 'team.flash.invited');

        $staff = Staff::query()->where('email', 'jana.admin@speedclub.test')->sole();
        expect(adm36Roles($staff))->toBe(['support'])
            ->and(adm36Pending('staff.role_elevation')?->payload['roles'])->toBe(['admin', 'support']);
    });

    it('lets only an Owner invite an Owner', function () {
        adm36As('admin');
        $this->post('/admin/team/invite', ['name' => 'Jana Wolff', 'email' => 'jana.owner@speedclub.test', 'roles' => ['owner'], 'locale' => 'de', 'reason' => adm36Reason()])
            ->assertSessionHas('error', __('team.refused.owner_only'));

        expect(Staff::query()->where('email', 'jana.owner@speedclub.test')->exists())->toBeFalse();
    });
});

describe('ADM-40 staff detail', function () {
    it('shows roles, atoms, sessions and what the viewer may do, by the Owner rules', function () {
        $owner = adm36Staff('owner');
        $support = adm36Staff('support');
        adm36As('admin');

        $this->get("/admin/team/{$support->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Team/Show')
            ->where('member.roles', ['support'])
            ->where('member.atoms', fn ($atoms) => collect($atoms)->contains('support.reply'))
            ->where('can.roles', true)->where('can.deactivate', true)->where('can.delete', false)->where('can.reset_two_factor', false)
            ->has('sessions')->has('activity'));

        $this->get("/admin/team/{$owner->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('can.roles', false)->where('can.deactivate', false)->where('can.revoke_sessions', false));
    });

    it('applies a plain role change at once', function () {
        $target = adm36Staff('analyst');
        adm36As('admin');

        $this->patch("/admin/team/{$target->id}/roles", ['roles' => ['support']])->assertSessionHas('success', 'team.flash.roles_changed');

        expect(adm36Roles($target))->toBe(['support']);
    });

    it('turns every four-eyes step into a pending request and changes nothing (direct POST cannot bypass)', function (string $role, string $method, string $path, array $data, string $handler) {
        $target = adm36Staff($role, $path === 'reactivate' || $path === 'delete' ? ['status' => StaffStatus::Deactivated] : []);
        adm36Staff('owner');
        adm36As('owner');
        $before = ['roles' => adm36Roles($target), 'status' => $target->fresh()->status, 'anonymised' => $target->fresh()->anonymised_at];

        $this->call($method, "/admin/team/{$target->id}/{$path}", $data)->assertRedirect()->assertSessionHas('approval');

        $fresh = $target->fresh();
        expect(adm36Pending($handler))->not->toBeNull()
            ->and(adm36Roles($target))->toBe($before['roles'])
            ->and($fresh->status)->toBe($before['status'])
            ->and($fresh->anonymised_at)->toBe($before['anonymised']);
    })->with([
        'grant Admin' => ['support', 'PATCH', 'roles', ['roles' => ['admin'], 'reason' => 'Übernimmt die Vertretung ab Montag.'], 'staff.role_elevation'],
        'demote Admin (SF-6)' => ['admin', 'PATCH', 'roles', ['roles' => ['support'], 'reason' => 'Wechselt zurück in den Support.'], 'staff.role_elevation'],
        'deactivate Admin' => ['admin', 'POST', 'deactivate', ['reason' => 'Verlässt das Team zum Monatsende.'], 'staff.deactivate_privileged'],
        'deactivate Owner' => ['owner', 'POST', 'deactivate', ['reason' => 'Verlässt das Team zum Monatsende.'], 'staff.deactivate_privileged'],
        'reactivate Owner (SF-6)' => ['owner', 'POST', 'reactivate', ['reason' => 'Kommt aus der Elternzeit zurück.'], 'staff.reactivate_owner'],
        'delete Owner' => ['owner', 'POST', 'delete', ['reason' => 'Konto wird nicht mehr gebraucht.'], 'staff.delete_owner'],
        'reset 2FA' => ['support', 'POST', 'reset-two-factor', ['reason' => 'Telefon mit Authenticator verloren.'], 'staff.reset_two_factor'],
    ]);

    it('lets an approval of a role elevation run only through the engine, by a second admin', function () {
        $target = adm36Staff('support');
        $requester = adm36As('admin');
        $this->patch("/admin/team/{$target->id}/roles", ['roles' => ['admin'], 'reason' => adm36Reason()])->assertSessionHas('approval');
        $request = adm36Pending('staff.role_elevation');

        // The requester cannot approve, the second admin can.
        adm36SignIn($requester);
        $this->post("/admin/team/approvals/{$request->id}/approve")->assertForbidden();
        adm36SignIn(adm36Staff('admin'));
        $this->post("/admin/team/approvals/{$request->id}/approve")->assertRedirect();

        expect($request->fresh()->status)->toBe(ApprovalStatus::Executed)->and(adm36Roles($target))->toBe(['admin']);
    });

    it('refuses the own account and the last active Owner, and Owner steps by an Admin', function () {
        $owner = adm36As('owner');
        $this->post("/admin/team/{$owner->id}/deactivate", ['reason' => adm36Reason()])->assertSessionHas('error', __('team.refused.self'));
        $admin = adm36SignIn(adm36Staff('admin'));
        $this->patch("/admin/team/{$admin->id}/roles", ['roles' => ['admin', 'owner'], 'reason' => adm36Reason()])->assertSessionHas('error', __('team.refused.self_elevation'));

        $other = adm36Staff('owner');
        adm36As('admin');
        $this->post("/admin/team/{$other->id}/deactivate", ['reason' => adm36Reason()])->assertSessionHas('error', __('team.refused.owner_only'));
        $this->post("/admin/team/{$other->id}/reset-two-factor", ['reason' => adm36Reason()])->assertSessionHas('error');

        expect($other->fresh()->status)->toBe(StaffStatus::Active)->and(ApprovalRequest::query()->count())->toBe(0);
    });

    it('keeps the last active Owner at execution: an approved demotion of the only Owner fails', function () {
        $owner = adm36As('owner');
        $invited = adm36Staff('owner', ['password_proof_required' => true]);
        Staff::query()->role('owner', 'staff')->whereKeyNot([$owner->id, $invited->id])->update(['status' => StaffStatus::Deactivated->value]);

        $this->patch("/admin/team/{$owner->id}/roles", ['roles' => ['admin'], 'reason' => adm36Reason()])->assertSessionHas('approval');
        $result = app(Approvals::class)->approve(adm36Pending('staff.role_elevation'), $invited);

        expect($result->status)->toBe(ApprovalStatus::Failed)->and(adm36Roles($owner))->toBe(['owner']);
    });

    it('refuses a fourth Owner', function () {
        seedStaffRoles();
        Staff::query()->role('owner', 'staff')->delete();
        $requester = adm36As('owner');
        adm36Staff('owner');
        adm36Staff('owner');
        adm36SignIn($requester);

        $this->post('/admin/team/invite', ['name' => 'Vierter Owner', 'email' => 'owner4@speedclub.test', 'roles' => ['owner'], 'locale' => 'de', 'reason' => adm36Reason()])
            ->assertSessionHas('error', __('team.refused.max_owners', ['max' => 3]));
    });

    it('applies a plain deactivation, reactivation and deletion with a reason', function () {
        $target = adm36Staff('support');
        adm36As('admin');

        $this->post("/admin/team/{$target->id}/deactivate", ['reason' => 'Verlässt das Team zum Monatsende.'])->assertSessionHas('success', 'team.flash.deactivated');
        expect($target->fresh()->status)->toBe(StaffStatus::Deactivated);

        $this->post("/admin/team/{$target->id}/reactivate", ['reason' => 'Kommt aus der Elternzeit zurück.'])->assertSessionHas('success', 'team.flash.reactivated');
        expect($target->fresh()->status)->toBe(StaffStatus::Active);

        $this->post("/admin/team/{$target->id}/deactivate", ['reason' => 'Verlässt das Team zum Monatsende.']);
        $this->post("/admin/team/{$target->id}/delete", ['reason' => 'x'])->assertSessionHasErrors('reason');
        $this->post("/admin/team/{$target->id}/delete", ['reason' => 'Konto wird nicht mehr gebraucht.'])->assertSessionHas('success', 'team.flash.deleted');
        expect($target->fresh()->anonymised_at)->not->toBeNull();
    });
});

describe('invite page', function () {
    it('is a guest page that sets the password once, then the account must enrol TOTP', function () {
        $staff = adm36Staff('support', ['password_proof_required' => true]);
        $link = app(StaffInvites::class)->issue($staff, null);
        parse_str((string) parse_url($link, PHP_URL_FRAGMENT), $fragment);
        $token = (string) $fragment['token'];

        $this->get('/admin/invite')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Auth/AcceptInvite')->has('passwordMinLength'));

        $this->post('/admin/invite', ['token' => $token, 'password' => 'Lange Nacht im Hafen 2026', 'password_confirmation' => 'Lange Nacht im Hafen 2026'])
            ->assertRedirect('/admin/login')->assertSessionHas('status', 'team.invite.accepted');
        expect($staff->fresh()->password_proof_required)->toBeFalse();

        // Single use.
        $this->post('/admin/invite', ['token' => $token, 'password' => 'Noch ein anderes Passwort 1', 'password_confirmation' => 'Noch ein anderes Passwort 1'])
            ->assertSessionHasErrors(['token' => __('team.refused.invite_invalid')]);
    });

    it('answers the same for an expired link', function () {
        $staff = adm36Staff('support', ['password_proof_required' => true]);
        parse_str((string) parse_url(app(StaffInvites::class)->issue($staff, null), PHP_URL_FRAGMENT), $fragment);
        $this->travel(73)->hours();

        $this->post('/admin/invite', ['token' => $fragment['token'], 'password' => 'Lange Nacht im Hafen 2026', 'password_confirmation' => 'Lange Nacht im Hafen 2026'])
            ->assertSessionHasErrors(['token' => __('team.refused.invite_invalid')]);
        expect($staff->fresh()->password_proof_required)->toBeTrue();
    });

    it('is rate-limited', function () {
        RateLimiter::clear('invite');
        foreach (range(1, 10) as $ignored) {
            $this->post('/admin/invite', ['token' => str_repeat('a', 64), 'password' => 'x', 'password_confirmation' => 'x']);
        }

        $this->post('/admin/invite', ['token' => str_repeat('a', 64), 'password' => 'x', 'password_confirmation' => 'x'])->assertStatus(429);
    });
});
