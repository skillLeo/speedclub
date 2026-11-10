<?php

use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\DeactivateStaff;
use App\Actions\Admin\Team\ReactivateStaff;
use App\Actions\Admin\Team\ResetStaffTwoFactor;
use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\Concerns\NamesAStaffMember;
use App\Services\Approvals\HandlerRegistry;
use Illuminate\Auth\Access\AuthorizationException;

require_once __DIR__.'/TeamHelpers.php';

/**
 * ADR-237: the staff member an approval request is about can never approve it, for every handler whose subject is a staff member.
 * Each case builds a request whose subject would otherwise be allowed to approve (active, approvals.decide, the atoms, an Owner where
 * needed), proves the refusal, and that another eligible staff member can still approve.
 */
function m36SelfCase(string $handler): array
{
    return match ($handler) {
        'staff.role_elevation' => (function (): array {
            $subject = m31Staff('owner');
            m31Staff('owner');

            return [$subject, app(ChangeStaffRoles::class)->handle(m31Staff('owner'), $subject, ['admin', 'owner'], m36Reason())->approval];
        })(),
        'staff.deactivate_privileged' => (function (): array {
            $subject = m31Staff('admin');

            return [$subject, app(DeactivateStaff::class)->handle(m31Staff('admin'), $subject, m36Reason())->approval];
        })(),
        'staff.delete_owner' => (function (): array {
            $subject = m31Staff('owner', attributes: ['status' => StaffStatus::Deactivated]);
            $approval = app(Approvals::class)->request('staff.delete_owner', ['staff_id' => $subject->id], m36Reason(), m31Staff('owner'), $subject);

            return [$subject, $approval];
        })(),
        'staff.reactivate_owner' => (function (): array {
            $subject = m31Staff('owner', attributes: ['status' => StaffStatus::Deactivated]);
            $approval = app(ReactivateStaff::class)->handle(m31Staff('owner'), $subject, m36Reason())->approval;

            return [$subject, $approval];
        })(),
        'staff.reset_two_factor' => (function (): array {
            $subject = m31Staff('owner');

            return [$subject, app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), $subject, m36Reason())->approval];
        })(),
    };
}

it('covers every handler that names a staff member', function () {
    $staffHandlers = array_keys(array_filter(app(HandlerRegistry::class)->all(), fn (object $handler): bool => in_array(NamesAStaffMember::class, class_uses($handler), true)));
    sort($staffHandlers);

    expect($staffHandlers)->toBe(['staff.deactivate_privileged', 'staff.delete_owner', 'staff.reactivate_owner', 'staff.reset_two_factor', 'staff.role_elevation']);
});

it('never lets the staff member a request is about approve it', function (string $handler) {
    [$subject, $approval] = m36SelfCase($handler);

    if (in_array($handler, ['staff.delete_owner', 'staff.reactivate_owner'], true)) {
        // An Owner is deactivated before the deletion or reactivation is asked; active here so only the self rule stands between them and it.
        $subject->forceFill(['status' => StaffStatus::Active])->save();
        $subject = $subject->fresh();
    }

    expect($approval)->toBeInstanceOf(ApprovalRequest::class)
        ->and(app(Approvals::class)->mayDecide($approval, $subject))->toBeFalse()
        ->and(app(Approvals::class)->pendingFor($subject)->pluck('id'))->not->toContain($approval->id)
        ->and(app(Approvals::class)->countFor($subject))->toBe(0)
        ->and(fn () => app(Approvals::class)->approve($approval, $subject))->toThrow(AuthorizationException::class)
        ->and(fn () => app(Approvals::class)->deny($approval, $subject, 'Nicht über mich selbst.'))->toThrow(AuthorizationException::class)
        ->and($approval->fresh()->status)->toBe(ApprovalStatus::Pending)
        ->and(app(Approvals::class)->mayDecide($approval, m31Staff('owner')))->toBeTrue();
})->with(['staff.role_elevation', 'staff.deactivate_privileged', 'staff.delete_owner', 'staff.reactivate_owner', 'staff.reset_two_factor']);

it('also refuses when only the payload names the staff member', function () {
    $subject = m31Staff('admin');
    $approval = app(DeactivateStaff::class)->handle(m31Staff('admin'), $subject, m36Reason())->approval;
    ApprovalRequest::query()->whereKey($approval->id)->update(['subject_type' => null, 'subject_id' => null]);

    expect(Approvals::isAbout($approval->fresh(), $subject))->toBeTrue()
        ->and(fn () => app(Approvals::class)->approve($approval->fresh(), $subject))->toThrow(AuthorizationException::class);
});

it('leaves requests about others decidable', function () {
    $approver = m31Staff('admin');
    $approval = app(DeactivateStaff::class)->handle(m31Staff('admin'), m31Staff('admin'), m36Reason())->approval;

    expect(Approvals::isAbout($approval, $approver))->toBeFalse()
        ->and(app(Approvals::class)->approve($approval, $approver)->status)->toBe(ApprovalStatus::Executed);
});

it('keeps requests without a subject decidable and counted (NULL-safe self rule)', function () {
    $approver = m31Staff('owner');
    $approval = app(Approvals::class)->request('audit.export', ['format' => 'csv', 'filter' => []], m36Reason(), m31Staff('owner'));

    expect($approval->subject_type)->toBeNull()
        ->and(Approvals::isAbout($approval, $approver))->toBeFalse()
        ->and(app(Approvals::class)->pendingFor($approver)->pluck('id'))->toContain($approval->id)
        ->and(app(Approvals::class)->countFor($approver))->toBe(1);
});

it('keeps a request about another staff member in the list of the approver', function () {
    $approver = m31Staff('admin');
    $approval = app(DeactivateStaff::class)->handle(m31Staff('admin'), m31Staff('admin'), m36Reason())->approval;

    expect(app(Approvals::class)->pendingFor($approver)->pluck('id'))->toContain($approval->id)
        ->and(app(Approvals::class)->countFor($approver))->toBe(1);
});
