<?php

use App\Actions\Admin\Team\DeactivateStaff;
use App\Actions\Admin\Team\DeleteStaff;
use App\Actions\Admin\Team\ReactivateStaff;
use App\Actions\Admin\Team\RevokeStaffSessions;
use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Models\AuditEvent;
use App\Models\PersonalAccessToken;
use App\Models\Staff;
use App\Models\User;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamRefused;
use App\Support\ViewAs;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/TeamHelpers.php';

function m36SessionRow(Staff $staff, string $id = 'session-a'): void
{
    DB::table('sessions')->insert(['id' => $id, 'user_id' => (string) $staff->id, 'user_agent' => 'Mozilla/5.0 (Macintosh) Firefox/130.0', 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);
}

it('lets only holders of staff.manage deactivate', function (string $role, bool $allowed) {
    $run = fn () => app(DeactivateStaff::class)->handle(m31Staff($role), m31Staff('analyst'), m36Reason());

    $allowed ? expect($run()->applied)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('staff.manage'));

it('deactivates a plain account at once: sessions, remember token, epoch and view-as end', function () {
    config(['session.driver' => 'database']);
    $target = m31Staff('support');
    m36SessionRow($target);
    $member = User::factory()->create();
    $member->createToken(ViewAs::NAME_PREFIX.$target->id, ['view-as']);
    $before = $target->fresh();

    app(DeactivateStaff::class)->handle(m31Staff('admin'), $target, m36Reason());
    $after = $target->fresh();

    expect($after->status)->toBe(StaffStatus::Deactivated)
        ->and($after->deactivated_at)->not->toBeNull()
        ->and($after->credentials_epoch)->not->toBe($before->credentials_epoch)
        ->and($after->remember_token)->not->toBe($before->remember_token)
        ->and(DB::table('sessions')->where('user_id', (string) $target->id)->count())->toBe(0)
        ->and(PersonalAccessToken::query()->where('name', ViewAs::NAME_PREFIX.$target->id)->count())->toBe(0)
        ->and(m36Roles($target))->toBe(['support'])
        ->and(AuditEvent::query()->where('action', TeamEvent::Deactivated->value)->sole()->after['sessions_ended'])->toBe(1);
});

it('needs a reason and refuses the own account', function () {
    $admin = m31Staff('admin');

    expect(fn () => app(DeactivateStaff::class)->handle($admin, m31Staff('analyst'), 'kurz'))->toThrow(ValidationException::class)
        ->and(fn () => app(DeactivateStaff::class)->handle($admin, $admin, m36Reason()))->toThrow(TeamRefused::class);
});

it('makes deactivating an Admin four-eyes, approved by another admin', function () {
    $target = m31Staff('admin');
    $outcome = app(DeactivateStaff::class)->handle(m31Staff('admin'), $target, m36Reason());

    expect($outcome->approval?->action)->toBe('staff.deactivate_privileged')
        ->and($target->fresh()->status)->toBe(StaffStatus::Active);

    expect(m36Approve($outcome->approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
        ->and($target->fresh()->status)->toBe(StaffStatus::Deactivated);
});

it('lets only an Owner deactivate an Owner, approved by an Owner', function () {
    $owner = m31Staff('owner');
    $other = m31Staff('owner');

    expect(fn () => app(DeactivateStaff::class)->handle(m31Staff('admin'), $owner, m36Reason()))->toThrow(TeamRefused::class);

    $outcome = app(DeactivateStaff::class)->handle($owner, $other, m36Reason());
    expect(fn () => m36Approve($outcome->approval, m31Staff('admin')))->toThrow(AuthorizationException::class)
        ->and(m36Approve($outcome->approval, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed)
        ->and($other->fresh()->status)->toBe(StaffStatus::Deactivated);
});

it('keeps one active Owner: a deactivation of the last one fails at execution', function () {
    $active = m31Staff('owner');
    $invited = m31Staff('owner', attributes: ['password_proof_required' => true]);

    $outcome = app(DeactivateStaff::class)->handle($invited, $active, m36Reason());
    $result = m36Approve($outcome->approval, m31Staff('owner', attributes: ['password_proof_required' => true]));

    expect($result->status)->toBe(ApprovalStatus::Failed)
        ->and($result->result['error'])->toBe(__('team.refused.last_owner'))
        ->and($active->fresh()->status)->toBe(StaffStatus::Active);
});

it('reactivates with a reason, by someone holding the account\'s atoms', function () {
    $target = m31Staff('admin', attributes: ['status' => StaffStatus::Deactivated]);

    expect(fn () => app(ReactivateStaff::class)->handle(m36StaffWith('staff.manage'), $target, m36Reason()))->toThrow(TeamRefused::class)
        ->and(fn () => app(ReactivateStaff::class)->handle(m31Staff('admin'), m31Staff('support'), m36Reason()))->toThrow(TeamRefused::class);

    app(ReactivateStaff::class)->handle(m31Staff('admin'), $target, m36Reason());
    expect($target->fresh()->status)->toBe(StaffStatus::Active)
        ->and(AuditEvent::query()->where('action', TeamEvent::Reactivated->value)->exists())->toBeTrue();
});

it('deletes only a deactivated account, keeping an anonymous row', function () {
    $target = m31Staff('support');

    expect(fn () => app(DeleteStaff::class)->handle(m31Staff('admin'), $target, m36Reason()))->toThrow(TeamRefused::class, __('team.refused.not_deactivated'));

    $target->forceFill(['status' => StaffStatus::Deactivated])->save();
    app(DeleteStaff::class)->handle(m31Staff('admin'), $target->fresh(), m36Reason());
    $row = $target->fresh();

    expect($row->anonymised_at)->not->toBeNull()
        ->and($row->name)->toBe(DeleteStaff::NAME)
        ->and($row->email)->toEndWith('@staff.invalid')
        ->and($row->two_factor_secret)->toBeNull()
        ->and(m36Roles($row))->toBe([])
        ->and(json_encode(AuditEvent::query()->where('action', TeamEvent::Deleted->value)->sole()->after))->not->toContain($target->email);
});

it('makes deleting an Owner four-eyes between Owners', function () {
    $target = m31Staff('owner', attributes: ['status' => StaffStatus::Deactivated]);
    $requester = m31Staff('owner');

    expect(fn () => app(DeleteStaff::class)->handle(m31Staff('admin'), $target, m36Reason()))->toThrow(TeamRefused::class);

    $outcome = app(DeleteStaff::class)->handle($requester, $target, m36Reason());
    expect($outcome->approval?->action)->toBe('staff.delete_owner')
        ->and(fn () => m36Approve($outcome->approval, m31Staff('admin')))->toThrow(AuthorizationException::class)
        ->and(m36Approve($outcome->approval, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed)
        ->and($target->fresh()->anonymised_at)->not->toBeNull();
});

it('ends another staff member\'s sessions, never one\'s own, an Owner\'s only by an Owner', function () {
    config(['session.driver' => 'database']);
    $target = m31Staff('support');
    m36SessionRow($target, 'a');
    m36SessionRow($target, 'b');

    expect(app(RevokeStaffSessions::class)->handle(m31Staff('admin'), $target))->toBe(2)
        ->and(DB::table('sessions')->where('user_id', (string) $target->id)->count())->toBe(0);

    $admin = m31Staff('admin');
    expect(fn () => app(RevokeStaffSessions::class)->handle($admin, $admin))->toThrow(TeamRefused::class)
        ->and(fn () => app(RevokeStaffSessions::class)->handle($admin, m31Staff('owner')))->toThrow(TeamRefused::class);
});

it('lists staff sessions by handle, never by session id', function () {
    config(['session.driver' => 'database']);
    $staff = m31Staff('support');
    m36SessionRow($staff, 'geheime-session-id');
    DB::table('sessions')->insert(['id' => 'member', 'user_id' => '01J0000000000000000000000A', 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);

    $list = app(StaffSessions::class)->list($staff, 'geheime-session-id');

    expect($list)->toHaveCount(1)
        ->and($list[0]['current'])->toBeTrue()
        ->and($list[0]['browser'])->toBe('Firefox')
        ->and(json_encode($list))->not->toContain('geheime-session-id');
});
