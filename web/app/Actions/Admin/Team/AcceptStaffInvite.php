<?php

namespace App\Actions\Admin\Team;

use App\Enums\TeamEvent;
use App\Models\Staff;
use App\Rules\NotPasswordHash;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Team\StaffInvites;
use App\Services\Team\TeamRefused;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

/**
 * The invite page (guest, POST with the token from the fragment): sets the password with the staff password rules (as the reset and
 * the change), clears password_proof_required (the mailbox is proved, SEC-P1-20), spends the link and moves the credentials epoch.
 * The account has no TOTP yet, so after signing in EnsureStaffTwoFactor holds it at enrolment (ADM-03). An unknown, used, replaced or
 * expired link answers the same `invite_invalid`.
 *
 * @throws ValidationException|TeamRefused
 */
class AcceptStaffInvite
{
    public function __construct(private readonly StaffInvites $invites) {}

    /**
     * @param  array<string, mixed>  $input  password, password_confirmation
     */
    public function handle(string $token, array $input): Staff
    {
        Validator::make($input, [
            'password' => ['required', 'string', Password::min(config()->integer('speedclub.passwords.min_length')), 'max:'.config()->integer('speedclub.passwords.max_length'), new NotPasswordHash, 'confirmed'],
        ])->validate();

        return DB::transaction(function () use ($token, $input): Staff {
            $invitation = $this->invites->find($token, lock: true);

            if ($invitation === null) {
                throw new TeamRefused('invite_invalid');
            }

            $staff = Staff::query()->whereKey($invitation->staff_id)->lockForUpdate()->firstOrFail();
            $staff->forceFill(['password' => Hash::make((string) $input['password']), 'password_proof_required' => false])->save();
            $invitation->forceFill(['used_at' => now()])->save();
            StaffCredentials::rotate($staff);

            Audit::record(TeamEvent::InviteAccepted->value, $staff, after: ['invitation_id' => $invitation->getKey()], actor: $staff);

            return $staff;
        });
    }
}
