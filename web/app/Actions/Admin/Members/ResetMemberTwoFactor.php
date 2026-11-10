<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Enums\SecurityNotice;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The executor of the four-eyes `members.reset_2fa`, refused unless Approvals::approve() is executing that request for this member
 * (FourEyes, MF-1): the TOTP key, the recovery codes and a lock
 * from too many wrong codes go, so the member signs in with the password alone and can enrol again. The member is mailed (the
 * two_factor_changed notice in its staff wording). Audited with requester and approver (keys named totp_*, as Audit redacts anything
 * called two_factor); the reason is the request's.
 *
 * @throws AuthorizationException
 */
class ResetMemberTwoFactor
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(Staff $requester, Staff $approver, User $member, string $reason): void
    {
        FourEyes::member(FourEyes::executor(['members.reset_2fa'], $requester, $approver, 'members.reset_2fa'), $member, 'reset_2fa');

        DB::transaction(function () use ($requester, $approver, $member, $reason): void {
            $locked = User::query()->whereKey($member->id)->lockForUpdate()->firstOrFail();
            $before = ['totp_on' => $locked->hasTwoFactor(), 'totp_locked' => $locked->hasLockedSecondFactor()];

            $locked->forceFill([
                'two_factor_secret' => null,
                'two_factor_confirmed_at' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_last_step' => null,
                'two_factor_locked_at' => null,
            ])->save();

            Audit::record(AdminMemberEvent::TwoFactorReset->value, $locked, $before, [
                'totp_on' => false,
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver->getKey(),
            ], $reason, $approver);
        });

        $this->notifier->security($member->refresh(), SecurityNotice::TwoFactorChanged, variant: 'reset_by_staff');
    }
}
