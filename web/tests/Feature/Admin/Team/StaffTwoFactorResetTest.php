<?php

use App\Actions\Admin\Team\ResetStaffTwoFactor;
use App\Enums\ApprovalStatus;
use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Mail\StaffTwoFactorResetMail;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Privacy\OrgIdentity;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/TeamHelpers.php';

beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
});

function m36ResetSession(Staff $staff, string $id): void
{
    DB::table('sessions')->insert(['id' => $id, 'user_id' => (string) $staff->id, 'user_agent' => 'Mozilla/5.0 Firefox/130.0', 'payload' => 'x', 'last_activity' => now()->getTimestamp()]);
}

it('is always four-eyes: an Owner asks, nothing changes before a second Owner approves', function () {
    $target = m31Staff('support');
    $outcome = app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), $target, m36Reason());

    expect($outcome->approval?->action)->toBe('staff.reset_two_factor')
        ->and($outcome->approval?->subject_id)->toBe((string) $target->id)
        ->and($target->fresh()->hasEnabledTwoFactorAuthentication())->toBeTrue();
    Mail::assertNothingSent();
});

it('lets only an Owner ask, never for the own account, only with a reason and a confirmed factor', function () {
    $owner = m31Staff('owner');

    expect(fn () => app(ResetStaffTwoFactor::class)->handle(m31Staff('admin'), m31Staff('support'), m36Reason()))->toThrow(TeamRefused::class, __('team.refused.owner_only'))
        ->and(fn () => app(ResetStaffTwoFactor::class)->handle(m31Staff('moderator'), m31Staff('support'), m36Reason()))->toThrow(AuthorizationException::class)
        ->and(fn () => app(ResetStaffTwoFactor::class)->handle($owner, $owner, m36Reason()))->toThrow(TeamRefused::class, __('team.refused.self'))
        ->and(fn () => app(ResetStaffTwoFactor::class)->handle($owner, m31Staff('support', confirmed: false), m36Reason()))->toThrow(TeamRefused::class, __('team.refused.no_two_factor'))
        ->and(fn () => app(ResetStaffTwoFactor::class)->handle($owner, m31Staff('support', attributes: ['status' => StaffStatus::Deactivated]), m36Reason()))->toThrow(TeamRefused::class)
        ->and(fn () => app(ResetStaffTwoFactor::class)->handle($owner, m31Staff('support'), 'kurz'))->toThrow(ValidationException::class);
});

it('needs a second Owner to approve: not an Admin, not the requester', function () {
    $requester = m31Staff('owner');
    $approval = app(ResetStaffTwoFactor::class)->handle($requester, m31Staff('admin'), m36Reason())->approval;

    expect(fn () => m36Approve($approval, m31Staff('admin')))->toThrow(AuthorizationException::class)
        ->and(fn () => m36Approve($approval, $requester))->toThrow(AuthorizationException::class)
        ->and($approval->fresh()->status)->toBe(ApprovalStatus::Pending);
});

it('clears the factor, moves the epoch, ends sessions, forces a new password and enrolment, mails and audits', function () {
    config(['session.driver' => 'database']);
    $target = m31Staff('support');
    $target->forceFill(['two_factor_pending_secret' => encrypt('PENDING'), 'two_factor_pending_session' => str_repeat('a', 64), 'two_factor_pending_at' => now()])->save();
    m36ResetSession($target, 'reset-a');
    m36ResetSession($target, 'reset-b');
    $before = $target->fresh();
    $requester = m31Staff('owner');
    $approver = m31Staff('owner');

    $approval = app(ResetStaffTwoFactor::class)->handle($requester, $target, m36Reason())->approval;
    $done = m36Approve($approval, $approver);
    $after = $target->fresh();

    expect($done->status)->toBe(ApprovalStatus::Executed)
        ->and($after->two_factor_secret)->toBeNull()
        ->and($after->two_factor_recovery_codes)->toBeNull()
        ->and($after->two_factor_confirmed_at)->toBeNull()
        ->and($after->two_factor_pending_secret)->toBeNull()
        ->and($after->hasEnabledTwoFactorAuthentication())->toBeFalse()
        ->and($after->password_proof_required)->toBeTrue()
        ->and($after->credentials_epoch)->not->toBe($before->credentials_epoch)
        ->and($after->remember_token)->not->toBe($before->remember_token)
        ->and(DB::table('sessions')->where('user_id', (string) $target->id)->count())->toBe(0)
        ->and($after->status)->toBe(StaffStatus::Active);

    $event = AuditEvent::query()->where('action', TeamEvent::TwoFactorReset->value)->sole();
    expect($event->after['requested_by'])->toBe($requester->id)
        ->and($event->after['approved_by'])->toBe($approver->id)
        ->and($event->after['sessions_ended'])->toBe(2)
        ->and(json_encode([$event->before, $event->after]))->not->toContain('PENDING');

    Mail::assertSent(StaffTwoFactorResetMail::class, fn (StaffTwoFactorResetMail $mail) => $mail->hasTo($target->email) && $mail->locale === 'de');
});

it('mails in the org default locale', function () {
    ConfigVersion::factory()->create(['key' => 'org', 'status' => 'published', 'version' => 1, 'payload' => ['default_locale' => 'en']]);
    OrgIdentity::forget();
    $target = m31Staff('support');

    m36Approve(app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), $target, m36Reason())->approval, m31Staff('owner'));

    Mail::assertSent(StaffTwoFactorResetMail::class, fn (StaffTwoFactorResetMail $mail) => $mail->locale === 'en');
});

it('holds the account at enrolment once it signs in again', function () {
    $target = m31Staff('support');
    m36Approve(app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), $target, m36Reason())->approval, m31Staff('owner'));
    $target->forceFill(['password_proof_required' => false])->save();

    $this->actingAs($target->fresh(), 'staff')->get('/admin')->assertRedirect(url('admin/two-factor/setup'));
});

it('fails at approval when the factor is already gone', function () {
    $target = m31Staff('support');
    $approval = app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), $target, m36Reason())->approval;
    $target->forceFill(['two_factor_secret' => null, 'two_factor_confirmed_at' => null])->save();

    expect(m36Approve($approval, m31Staff('owner'))->status)->toBe(ApprovalStatus::Failed);
    Mail::assertNothingSent();
});

it('runs the executor only inside its approval', function () {
    $approval = app(ResetStaffTwoFactor::class)->handle(m31Staff('owner'), m31Staff('support'), m36Reason())->approval;

    expect(fn () => app(ResetStaffTwoFactor::class)->resetApproved($approval, Staff::query()->findOrFail($approval->requested_by), m31Staff('owner')))
        ->toThrow(AuthorizationException::class);
});
