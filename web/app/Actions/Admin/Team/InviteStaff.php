<?php

namespace App\Actions\Admin\Team;

use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Mail\StaffInviteMail;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Team\OwnerRules;
use App\Services\Team\RolePins;
use App\Services\Team\RoleSets;
use App\Services\Team\StaffInvites;
use App\Services\Team\TeamOutcome;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-39 "Einladen" (`staff.invite`, m3.6 §1): the account is created active with password_proof_required (it cannot sign in until the
 * password is set through the mailed link, ADR-218), with the roles that do not elevate; roles that grant Owner/Admin or `roles.manage`
 * wait for the four-eyes `staff.role_elevation` (then a reason is required). Only an Owner invites an Owner, and the Owner maximum
 * counts the invited one. Nobody grants atoms they do not hold. The link (72 h, single use) is mailed after the commit.
 *
 * @throws AuthorizationException|ValidationException|TeamRefused
 */
class InviteStaff
{
    public function __construct(
        private readonly StaffInvites $invites,
        private readonly OwnerRules $owners,
        private readonly Approvals $approvals,
        private readonly AuthMailer $mailer,
    ) {}

    /**
     * @param  array<array-key, mixed>  $roles
     */
    public function handle(Staff $by, string $name, string $email, array $roles, ?string $reason = null, string $locale = 'de'): TeamOutcome
    {
        StaffAtoms::ensure($by, 'staff.invite');

        $email = Str::lower(trim($email));
        $name = trim($name);
        Validator::make(['name' => $name, 'email' => $email, 'locale' => $locale], [
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'email' => ['required', 'string', 'email:rfc', 'max:191', Rule::unique('staff', 'email')],
            'locale' => ['required', Rule::in(config('speedclub.locales'))],
        ])->validate();

        $roles = RoleSets::validate($roles);

        // Before the atom check: the Owner role holds atoms no Admin has (StaffSeeder::OWNER_ONLY), and this is the clearer answer.
        if (in_array('owner', $roles, true) && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        RoleSets::ensureHolds($by, RoleSets::atomsOf($roles));

        $plain = array_values(array_filter($roles, fn (string $role): bool => ! RoleSets::elevates([], [$role])));
        $elevating = $plain !== $roles;

        $result = DB::transaction(function () use ($by, $name, $email, $roles, $plain, $elevating, $reason): array {
            if (in_array('owner', $roles, true)) {
                $this->owners->ensureRoomFor($this->owners->lock(), new Staff);
            }

            $staff = new Staff;
            $staff->forceFill([
                'name' => $name,
                'email' => $email,
                'password' => Str::password(40),
                'status' => StaffStatus::Active,
                'password_proof_required' => true,
            ])->save();
            $staff->syncRoles($plain);

            $link = $this->invites->issue($staff, $by);

            $approval = $elevating
                ? $this->approvals->request('staff.role_elevation', ['staff_id' => $staff->getKey(), 'roles' => $roles, 'before' => $plain, 'role_pins' => RolePins::pin([...$roles, ...$plain])], (string) $reason, $by, $staff)
                : null;

            Audit::record(TeamEvent::Invited->value, $staff, after: [
                'roles' => $plain,
                'pending_roles' => $elevating ? $roles : null,
                'approval_id' => $approval?->getKey(),
            ], reason: $reason, actor: $by);

            return [$staff, $link, $approval];
        });

        [$staff, $link, $approval] = $result;
        $this->mailer->sendLater($email, $locale, new StaffInviteMail($name, $link, now()->addHours(config()->integer('speedclub.team.invite_hours'))));

        return $approval !== null ? TeamOutcome::approval($approval, applied: true) : TeamOutcome::applied();
    }
}
