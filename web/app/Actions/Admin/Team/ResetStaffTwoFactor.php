<?php

namespace App\Actions\Admin\Team;

use App\Enums\TeamEvent;
use App\Mail\StaffTwoFactorResetMail;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\StaffCredentials;
use App\Services\Catalog\Reason;
use App\Services\Privacy\OrgIdentity;
use App\Services\Team\StaffSessions;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use App\Support\ViewAs;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADR-238 lost authenticator (ADM-40 "Zwei-Faktor zurücksetzen", `staff.manage`, with reason): always four-eyes
 * (`staff.reset_two_factor`). Only an Owner asks, for another staff member whose TOTP is confirmed; a second Owner approves (never the
 * staff member it is about, ADR-237). On execution, in the approving transaction: the factor, the recovery codes and a pending rotation are
 * cleared, password_proof_required is set (the next sign-in needs a new password through the e-mailed reset link, so whoever only knows
 * the password cannot enrol their own authenticator, SEC-P1-20), the credentials epoch moves and every session, the remember token and
 * every view-as the staff member started end. EnsureStaffTwoFactor then holds the account at enrolment (ADM-03). The staff member gets
 * a mail after the commit, in the org's default locale (staff have no locale of their own). Audited `staff.two_factor_reset`.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class ResetStaffTwoFactor
{
    public function __construct(
        private readonly Approvals $approvals,
        private readonly StaffSessions $sessions,
        private readonly AuthMailer $mailer,
        private readonly OrgIdentity $org,
    ) {}

    public function handle(Staff $by, Staff $target, string $reason): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.manage');
        $reason = Reason::required($reason);
        self::ensureMay($by, $target);

        return TeamOutcome::approval($this->approvals->request('staff.reset_two_factor', ['staff_id' => $target->getKey()], $reason, $by, $target));
    }

    /**
     * The executor of `staff.reset_two_factor`, only inside its approval (FourEyes). The rules are checked again with the requester.
     *
     * @throws AuthorizationException|TeamRefused
     */
    public function resetApproved(ApprovalRequest $request, Staff $requester, Staff $approver): void
    {
        FourEyes::executor(['staff.reset_two_factor'], $requester, $approver, 'staff.manage');

        if (! $approver->isOwner()) {
            throw new AuthorizationException('Only an Owner approves a two-factor reset.');
        }

        $target = Staff::query()->whereKey((int) $request->payload['staff_id'])->lockForUpdate()->firstOrFail();
        self::ensureMay($requester, $target);

        $target->forceFill([
            'two_factor_secret' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_pending_secret' => null,
            'two_factor_pending_session' => null,
            'two_factor_pending_at' => null,
            'password_proof_required' => true,
        ])->save();

        // First, so the view-as tokens end with this reason rather than the epoch's.
        $viewAs = ViewAs::revokeStartedBy($target, 'staff_credentials_changed');
        StaffCredentials::rotate($target);
        $sessions = $this->sessions->deleteAll($target);

        Audit::record(TeamEvent::TwoFactorReset->value, $target,
            before: ['two_factor' => 'confirmed'],
            after: [
                'two_factor' => 'enrolment_required',
                'password_proof_required' => true,
                'sessions_ended' => $sessions,
                'view_as_ended' => $viewAs,
                'requested_by' => $requester->getKey(),
                'approved_by' => $approver->getKey(),
            ],
            reason: $request->reason, actor: $approver);

        $email = (string) $target->email;
        $name = (string) $target->name;
        $locale = $this->org->defaultLocale();
        DB::afterCommit(fn () => $this->mailer->sendLater($email, $locale, new StaffTwoFactorResetMail($name)));
    }

    /**
     * An Owner, for another staff member's account that is active and has TOTP confirmed.
     *
     * @throws TeamRefused
     */
    public static function ensureMay(Staff $by, Staff $target): void
    {
        if ($by->getKey() === $target->getKey()) {
            throw new TeamRefused('self');
        }

        ChangeStaffRoles::ensureEditable($target);

        if (! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        if (! $target->hasEnabledTwoFactorAuthentication()) {
            throw new TeamRefused('no_two_factor');
        }
    }
}
