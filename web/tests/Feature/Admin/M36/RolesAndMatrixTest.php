<?php

use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\InviteStaff;
use App\Actions\Admin\Team\ReactivateStaff;
use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Role;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Team\TeamRefused;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use Inertia\Testing\AssertableInertia;
use Spatie\Permission\PermissionRegistrar;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-41/42 (m3.6-contract §1/§3) and the M3.4-batch review items SF-2, SF-3, SF-6, lane a: roles and the matrix by roles.manage, the diff
 * before saving, four-eyes for the sensitive atoms (and the approver who holds a changed role refused), a custom role with a sensitive
 * atom given to a person is four-eyes, demoting an Admin and reactivating an Owner are four-eyes.
 */
beforeEach(fn () => Mail::fake());

function adm36CustomRole(string $name, array $atoms): Role
{
    seedStaffRoles();
    $role = Role::findOrCreate($name, StaffSeeder::GUARD);
    $role->syncPermissions($atoms);
    app(PermissionRegistrar::class)->forgetCachedPermissions();

    return $role;
}

describe('ADM-41 roles', function () {
    it('guards role writes by roles.manage', function (string $method, string $uri, array $data) {
        $role = adm36CustomRole('Event-Team', ['support.view']);
        adm32WriteMatrix($method, str_replace('{role}', (string) $role->id, $uri), ADM36_OWNER_ADMIN, $data);
    })->with([
        'create' => ['POST', '/admin/team/roles', ['name' => 'Community-Team', 'description' => 'Beantwortet Tickets.', 'atoms' => ['support.view']]],
        'edit' => ['PATCH', '/admin/team/roles/{role}', ['name' => 'Event-Team', 'description' => 'Plant Treffen.', 'atoms' => ['support.view', 'support.reply']]],
        'delete' => ['DELETE', '/admin/team/roles/{role}', ['reason' => 'Rolle wird nicht mehr gebraucht.']],
    ]);

    it('lists roles with description, atoms and staff, and ids for the editor', function () {
        adm36CustomRole('Event-Team', ['support.view']);
        adm36As('admin');

        $this->get('/admin/team/roles')->assertInertia(fn (AssertableInertia $p) => $p->component('Team/Roles')
            ->has('ids.Event-Team')
            ->where('matrix.roles', fn ($roles) => collect($roles)->contains(fn ($r) => $r['name'] === 'Event-Team' && $r['system'] === false && $r['atoms'] === ['support.view'])
                && collect($roles)->contains(fn ($r) => $r['name'] === 'owner' && $r['locked'] === true)));
    });

    it('creates a custom role at once, but its sensitive atom waits for the approval', function () {
        adm36As('admin');

        $this->post('/admin/team/roles', ['name' => 'Community-Team', 'description' => 'Beantwortet Tickets.', 'atoms' => ['support.view', 'approvals.decide'], 'reason' => adm36Reason()])
            ->assertSessionHas('approval');

        $role = Role::findByName('Community-Team', StaffSeeder::GUARD);
        expect($role->getAttribute('description'))->toBe('Beantwortet Tickets.')
            ->and($role->permissions()->pluck('name')->all())->toBe([])
            ->and(adm36Pending('roles.sensitive_atoms'))->not->toBeNull();
    });

    it('deletes only a custom role nobody holds, with a reason', function () {
        $role = adm36CustomRole('Event-Team', ['support.view']);
        $holder = adm36Staff('analyst');
        $holder->assignRole($role);
        adm36As('admin');

        $this->delete("/admin/team/roles/{$role->id}", ['reason' => 'Rolle wird nicht mehr gebraucht.'])->assertSessionHas('error', __('team.refused.role_in_use', ['role' => 'Event-Team']));
        $holder->removeRole($role);
        $this->delete("/admin/team/roles/{$role->id}", ['reason' => 'Rolle wird nicht mehr gebraucht.'])->assertSessionHas('success', 'team.flash.role_deleted');

        $support = Role::findByName('support', StaffSeeder::GUARD);
        $this->delete("/admin/team/roles/{$support->id}", ['reason' => 'Rolle wird nicht mehr gebraucht.'])->assertSessionHas('error', __('team.refused.role_system', ['role' => 'support']));
    });
});

describe('ADM-42 permission matrix', function () {
    it('guards the diff and the save by roles.manage', function (string $method, string $uri) {
        adm32WriteMatrix($method, $uri, ADM36_OWNER_ADMIN, ['matrix' => ['analyst' => ['analytics.view']]], fn (TestResponse $r) => expect($r->status())->toBeIn([200, 302, 303, 422]));
    })->with([
        'diff' => ['POST', '/admin/team/permissions/diff'],
        'save' => ['PATCH', '/admin/team/permissions'],
    ]);

    it('shows the diff before saving: added and removed per role, staff affected, the sensitive grants', function () {
        adm36Staff('support');
        adm36Staff('support', ['status' => StaffStatus::Deactivated]);
        adm36As('admin');
        $support = StaffSeeder::ROLES['support'];

        $this->postJson('/admin/team/permissions/diff', ['matrix' => ['support' => [...array_diff($support, ['support.macros']), 'approvals.decide']]])
            ->assertOk()
            ->assertJsonPath('diff.support.added', ['approvals.decide'])
            ->assertJsonPath('diff.support.removed', ['support.macros'])
            ->assertJsonPath('diff.support.staff', 1)
            ->assertJsonPath('sensitive', ['approvals.decide'])
            ->assertJsonPath('staff', 1);

        expect(Role::findByName('support', StaffSeeder::GUARD)->hasPermissionTo('approvals.decide'))->toBeFalse();

        $this->postJson('/admin/team/permissions/diff', ['matrix' => ['admin' => []]])->assertStatus(422)->assertJsonPath('code', 'role_locked');
    });

    it('applies removals at once and makes a sensitive grant four-eyes; a direct PATCH never grants it', function () {
        adm36As('admin');
        $support = StaffSeeder::ROLES['support'];

        $this->patch('/admin/team/permissions', ['matrix' => ['support' => array_values(array_diff($support, ['support.macros']))]])->assertSessionHas('success', 'team.flash.permissions_saved');
        expect(Role::findByName('support', StaffSeeder::GUARD)->hasPermissionTo('support.macros'))->toBeFalse();

        $this->patch('/admin/team/permissions', ['matrix' => ['analyst' => [...StaffSeeder::ROLES['analyst'], 'audit.export']]])->assertSessionHasErrors();
        $this->patch('/admin/team/permissions', ['matrix' => ['analyst' => [...StaffSeeder::ROLES['analyst'], 'audit.export']], 'reason' => adm36Reason()])->assertSessionHas('approval');

        app(PermissionRegistrar::class)->forgetCachedPermissions();
        expect(Role::findByName('analyst', StaffSeeder::GUARD)->hasPermissionTo('audit.export'))->toBeFalse()
            ->and(adm36Pending('roles.sensitive_atoms'))->not->toBeNull();
    });

    it('asks for a recent password before saving', function () {
        adm36As('admin');
        adm36StalePassword();

        $this->patch('/admin/team/permissions', ['matrix' => ['analyst' => ['analytics.view']]])->assertSessionHas('confirm_password', true);
        expect(Role::findByName('analyst', StaffSeeder::GUARD)->permissions()->count())->toBe(count(StaffSeeder::ROLES['analyst']));
    });
});

describe('SF-2: a custom role with a sensitive atom given to a person is four-eyes', function () {
    it('asks for an approval instead of assigning the role', function (string $atom) {
        adm36CustomRole('Freigabe-Team', ['staff.view', $atom]);
        $target = adm36Staff('support');
        $requester = adm36Staff('admin');

        expect(fn () => app(ChangeStaffRoles::class)->handle($requester, $target, ['Freigabe-Team', 'support']))->toThrow(ValidationException::class);

        $outcome = app(ChangeStaffRoles::class)->handle($requester, $target, ['Freigabe-Team', 'support'], adm36Reason());
        expect($outcome->applied)->toBeFalse()
            ->and($outcome->approval?->action)->toBe('staff.role_elevation')
            ->and(adm36Roles($target))->toBe(['support']);

        expect(app(Approvals::class)->approve($outcome->approval, adm36Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
            ->and(adm36Roles($target))->toBe(['Freigabe-Team', 'support']);
    })->with(['approvals.decide', 'members.delete', 'members.export', 'audit.export', 'maintenance.toggle', 'roles.manage']);

    it('keeps a custom role without sensitive atoms a plain change', function () {
        adm36CustomRole('Event-Team', ['support.view', 'support.reply']);
        $target = adm36Staff('analyst');

        expect(app(ChangeStaffRoles::class)->handle(adm36Staff('admin'), $target, ['Event-Team'])->applied)->toBeTrue()
            ->and(adm36Roles($target))->toBe(['Event-Team']);
    });

    it('also holds back such a role on an invitation, and over HTTP', function () {
        adm36CustomRole('Freigabe-Team', ['approvals.decide']);
        $outcome = app(InviteStaff::class)->handle(adm36Staff('admin'), 'Jana Wolff', 'jana.sf2@speedclub.test', ['Freigabe-Team', 'support'], adm36Reason());
        expect(adm36Roles(Staff::query()->where('email', 'jana.sf2@speedclub.test')->sole()))->toBe(['support'])
            ->and($outcome->approval?->action)->toBe('staff.role_elevation');

        $target = adm36Staff('support');
        adm36As('admin');
        $this->patch("/admin/team/{$target->id}/roles", ['roles' => ['Freigabe-Team'], 'reason' => adm36Reason()])->assertSessionHas('approval');
        expect(adm36Roles($target))->toBe(['support']);
    });

    it('lets only an approver who holds the granted atom approve it', function () {
        adm36CustomRole('Freigabe-Team', ['members.delete']);
        $approver = adm36Staff('analyst');
        $approver->givePermissionTo(['approvals.decide', 'staff.manage', 'roles.manage']);
        $outcome = app(ChangeStaffRoles::class)->handle(adm36Staff('admin'), adm36Staff('support'), ['Freigabe-Team', 'support'], adm36Reason());

        expect(app(Approvals::class)->mayDecide($outcome->approval, $approver->fresh()))->toBeFalse()
            ->and(app(Approvals::class)->mayDecide($outcome->approval, adm36Staff('admin')))->toBeTrue();
    });
});

describe('SF-3: an approver who holds a role in a roles.sensitive_atoms change cannot approve it', function () {
    it('refuses, hides and does not count the request for a holder of the role', function () {
        adm36CustomRole('Freigabe-Team', ['staff.view']);
        $requester = adm36Staff('admin');
        $holder = adm36Staff('admin');
        $holder->assignRole('Freigabe-Team');
        $outcome = app(ApplyPermissionMatrix::class)->handle($requester, ['Freigabe-Team' => ['staff.view', 'approvals.decide']], adm36Reason());
        $approval = $outcome->approval;

        expect($approval)->toBeInstanceOf(ApprovalRequest::class)
            ->and(app(Approvals::class)->mayDecide($approval, $holder->fresh()))->toBeFalse()
            ->and(app(Approvals::class)->pendingFor($holder->fresh())->pluck('id'))->not->toContain($approval->id)
            ->and(app(Approvals::class)->countFor($holder->fresh()))->toBe(0)
            ->and(fn () => app(Approvals::class)->approve($approval, $holder->fresh()))->toThrow(AuthorizationException::class)
            ->and($approval->fresh()->status)->toBe(ApprovalStatus::Pending);

        $other = adm36Staff('admin');
        expect(app(Approvals::class)->countFor($other))->toBe(1)
            ->and(app(Approvals::class)->approve($approval, $other)->status)->toBe(ApprovalStatus::Executed);
    });

    it('refuses over HTTP too', function () {
        adm36CustomRole('Freigabe-Team', ['staff.view']);
        $holder = adm36Staff('admin');
        $holder->assignRole('Freigabe-Team');
        $approval = app(ApplyPermissionMatrix::class)->handle(adm36Staff('admin'), ['Freigabe-Team' => ['staff.view', 'members.export']], adm36Reason())->approval;

        adm36SignIn($holder->fresh());
        $this->post("/admin/team/approvals/{$approval->id}/approve")->assertForbidden();
        expect($approval->fresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('does not refuse a holder of a role the change only takes atoms from', function () {
        adm36CustomRole('Freigabe-Team', ['staff.view', 'support.view']);
        adm36CustomRole('Andere', ['staff.view']);
        $holder = adm36Staff('admin');
        $holder->assignRole('Freigabe-Team');
        $approval = app(ApplyPermissionMatrix::class)->handle(adm36Staff('admin'), ['Freigabe-Team' => ['staff.view'], 'Andere' => ['staff.view', 'audit.export']], adm36Reason())->approval;

        expect(app(Approvals::class)->mayDecide($approval, $holder->fresh()))->toBeTrue();
    });
});

describe('SF-6: demoting an Admin and reactivating an Owner are four-eyes', function () {
    it('makes demoting an Admin a staff.role_elevation request that a second Admin approves', function () {
        $target = adm36Staff('admin');
        $requester = adm36Staff('admin');

        $outcome = app(ChangeStaffRoles::class)->handle($requester, $target, ['support'], adm36Reason());
        expect($outcome->approval?->action)->toBe('staff.role_elevation')
            ->and(adm36Roles($target))->toBe(['admin'])
            ->and(fn () => app(Approvals::class)->approve($outcome->approval, $target->fresh()))->toThrow(AuthorizationException::class)
            ->and(app(Approvals::class)->approve($outcome->approval, adm36Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
            ->and(adm36Roles($target))->toBe(['support']);
    });

    it('also makes an Admin stepping down four-eyes, and needs a reason', function () {
        $admin = adm36Staff('admin');

        expect(fn () => app(ChangeStaffRoles::class)->handle($admin, $admin, ['support']))->toThrow(ValidationException::class)
            ->and(app(ChangeStaffRoles::class)->handle($admin, $admin, ['support'], adm36Reason())->approval?->action)->toBe('staff.role_elevation');
    });

    it('makes reactivating an Owner a staff.reactivate_owner request, asked and approved by Owners', function () {
        seedStaffRoles();
        Staff::query()->role('owner', 'staff')->delete();
        $target = adm36Staff('owner', ['status' => StaffStatus::Deactivated]);
        $requester = adm36Staff('owner');

        expect(fn () => app(ReactivateStaff::class)->handle(adm36Staff('admin'), $target, adm36Reason()))->toThrow(TeamRefused::class);

        $outcome = app(ReactivateStaff::class)->handle($requester, $target, adm36Reason());
        expect($outcome->approval?->action)->toBe('staff.reactivate_owner')
            ->and($target->fresh()->status)->toBe(StaffStatus::Deactivated)
            ->and(app(Approvals::class)->mayDecide($outcome->approval, adm36Staff('admin')))->toBeFalse()
            ->and(app(Approvals::class)->approve($outcome->approval, adm36Staff('owner'))->result)->toBe(['staff_id' => $target->id])
            ->and($target->fresh()->status)->toBe(StaffStatus::Active);
    });

    it('keeps reactivating a non-Owner a plain step', function () {
        $target = adm36Staff('support', ['status' => StaffStatus::Deactivated]);

        expect(app(ReactivateStaff::class)->handle(adm36Staff('admin'), $target, adm36Reason())->applied)->toBeTrue()
            ->and($target->fresh()->status)->toBe(StaffStatus::Active);
    });

    it('runs the reactivation executor only inside its approval', function () {
        $target = adm36Staff('owner', ['status' => StaffStatus::Deactivated]);
        $request = app(ReactivateStaff::class)->handle(adm36Staff('owner'), $target, adm36Reason())->approval;

        expect(fn () => app(ReactivateStaff::class)->reactivateApproved($request, Staff::query()->findOrFail($request->requested_by), adm36Staff('owner')))
            ->toThrow(AuthorizationException::class)
            ->and($target->fresh()->status)->toBe(StaffStatus::Deactivated);
    });

    it('fails an approved reactivation over the Owner maximum', function () {
        seedStaffRoles();
        Staff::query()->role('owner', 'staff')->delete();
        $target = adm36Staff('owner', ['status' => StaffStatus::Deactivated]);
        $requester = adm36Staff('owner');
        $approver = adm36Staff('owner');
        $request = app(ReactivateStaff::class)->handle($requester, $target, adm36Reason())->approval;
        adm36Staff('owner');

        expect(app(Approvals::class)->approve($request, $approver)->status)->toBe(ApprovalStatus::Failed)
            ->and($target->fresh()->status)->toBe(StaffStatus::Deactivated);
    });
});
