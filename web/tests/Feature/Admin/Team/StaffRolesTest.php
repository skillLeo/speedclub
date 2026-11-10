<?php

use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Enums\ApprovalStatus;
use App\Enums\TeamEvent;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\Models\Role;

require_once __DIR__.'/TeamHelpers.php';

function m36Change($by, $target, array $roles, ?string $reason = null)
{
    return app(ChangeStaffRoles::class)->handle($by, $target, $roles, $reason);
}

it('lets only holders of staff.manage change roles', function (string $role, bool $allowed) {
    $run = fn () => m36Change(m31Staff($role), m31Staff('analyst'), ['analyst', 'content_editor']);

    $allowed ? expect($run()->applied)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('staff.manage'));

it('applies a plain change at once with the atom diff in the audit row', function () {
    $target = m31Staff('analyst');
    m36Change(m31Staff('admin'), $target, ['support']);

    $event = AuditEvent::query()->where('action', TeamEvent::RolesChanged->value)->sole();

    expect(m36Roles($target))->toBe(['support'])
        ->and($event->before['roles'])->toBe(['analyst'])
        ->and($event->after['atoms_added'])->toContain('members.view_pii')
        ->and($event->after['atoms_removed'])->toContain('analytics.view')
        ->and($event->after['approved_by'])->toBeNull();
});

it('makes a change to Admin four-eyes: pending first, a second admin approves, then active (A4)', function () {
    $requester = m31Staff('admin');
    $target = m31Staff('support');

    $outcome = m36Change($requester, $target, ['admin'], m36Reason());

    expect($outcome->applied)->toBeFalse()
        ->and($outcome->approval->action)->toBe('staff.role_elevation')
        ->and($outcome->approval->summary['lines'][0])->toBe(['label' => 'approvals.staff_role_elevation.roles', 'before' => 'support', 'after' => 'admin'])
        ->and(m36Roles($target))->toBe(['support']);

    expect(fn () => m36Approve($outcome->approval, $requester))->toThrow(AuthorizationException::class);

    $approver = m31Staff('admin');
    expect(m36Approve($outcome->approval, $approver)->status)->toBe(ApprovalStatus::Executed)
        ->and(m36Roles($target))->toBe(['admin']);

    $event = AuditEvent::query()->where('action', TeamEvent::RolesChanged->value)->sole();
    expect($event->after['requested_by'])->toBe($requester->id)
        ->and($event->after['approved_by'])->toBe($approver->id)
        ->and($event->actor_id)->toBe((string) $approver->id);
});

it('makes granting roles.manage through a role four-eyes and needs a reason then', function () {
    m31Roles();
    Role::findOrCreate('m36-rolemanager', 'staff')->syncPermissions(['roles.manage', 'staff.view']);

    expect(fn () => m36Change(m31Staff('admin'), m31Staff('analyst'), ['m36-rolemanager']))->toThrow(ValidationException::class);

    $outcome = m36Change(m31Staff('admin'), m31Staff('analyst'), ['m36-rolemanager'], m36Reason());
    expect($outcome->approval?->action)->toBe('staff.role_elevation');
});

it('needs an Owner to grant Owner and an Owner to approve it', function () {
    $target = m31Staff('admin');

    expect(fn () => m36Change(m31Staff('admin'), $target, ['owner'], m36Reason()))->toThrow(TeamRefused::class, __('team.refused.owner_only'));

    $outcome = m36Change(m31Staff('owner'), $target, ['owner'], m36Reason());

    expect(fn () => m36Approve($outcome->approval, m31Staff('admin')))->toThrow(AuthorizationException::class)
        ->and(m36Approve($outcome->approval, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed)
        ->and(m36Roles($target))->toBe(['owner']);
});

it('refuses self-elevation, but lets an Owner step down with an approval', function () {
    $staff = m36StaffWith('staff.manage', 'roles.manage', 'staff.view');

    expect(fn () => m36Change($staff, $staff, [...m36Roles($staff), 'analyst']))->toThrow(TeamRefused::class, __('team.refused.self_elevation'));

    $admin = m31Staff('admin');
    expect(fn () => m36Change($admin, $admin, ['owner'], m36Reason()))->toThrow(TeamRefused::class, __('team.refused.self_elevation'));

    $owner = m31Staff('owner');
    m31Staff('owner');
    $outcome = m36Change($owner, $owner, ['admin'], m36Reason());
    expect($outcome->approval?->action)->toBe('staff.role_elevation');
});

it('refuses to grant atoms the changer does not hold', function () {
    $staff = m36StaffWith('staff.manage', 'staff.view');

    expect(fn () => m36Change($staff, m31Staff('analyst'), ['support']))->toThrow(TeamRefused::class);
});

it('keeps the last active Owner when an Owner steps down (checked at execution, under the lock)', function () {
    $owner = m31Staff('owner');
    // A second Owner who has not set a password yet does not count as active, but may approve in this test.
    $invited = m31Staff('owner', attributes: ['password_proof_required' => true]);

    $outcome = m36Change($owner, $owner, ['admin'], m36Reason());
    $result = m36Approve($outcome->approval, $invited);

    expect($result->status)->toBe(ApprovalStatus::Failed)
        ->and($result->result['error'])->toBe(__('team.refused.last_owner'))
        ->and(m36Roles($owner))->toBe(['owner']);
});

it('refuses a fourth Owner at execution', function () {
    $requester = m31Staff('owner');
    $approver = m31Staff('owner');
    $target = m31Staff('admin');
    $outcome = m36Change($requester, $target, ['owner'], m36Reason());
    m31Staff('owner');

    $result = m36Approve($outcome->approval, $approver);

    expect($result->status)->toBe(ApprovalStatus::Failed)
        ->and(m36Roles($target))->toBe(['admin']);
});

it('fails an approval whose roles changed in between', function () {
    $target = m31Staff('support');
    $outcome = m36Change(m31Staff('admin'), $target, ['admin'], m36Reason());
    $target->syncRoles(['analyst']);

    expect(m36Approve($outcome->approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Failed)
        ->and(m36Roles($target))->toBe(['analyst']);
});

it('runs the executor only inside its approval', function () {
    $request = ApprovalRequest::query()->forceCreate([
        'action' => 'staff.role_elevation', 'payload' => ['staff_id' => 1, 'roles' => ['admin'], 'before' => []], 'summary' => [],
        'reason' => m36Reason(), 'requested_by' => m31Staff('admin')->id, 'status' => ApprovalStatus::Pending, 'expires_at' => now()->addDay(),
    ]);

    expect(fn () => app(ChangeStaffRoles::class)->applyApproved($request, m31Staff('admin'), m31Staff('admin')))->toThrow(AuthorizationException::class);
});
