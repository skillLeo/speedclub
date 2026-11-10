<?php

namespace App\Actions\Fortify;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Rules\NotPasswordHash;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

/**
 * POST /admin/reset-password with the token from the mail. The mail proved the mailbox: a seeded or invited account may sign in from
 * now on (SEC-P1-20). Every session of the account ends (SEC-P1-25), including one from before the reset that still sits inside its
 * password confirmation window.
 */
class ResetStaffPassword implements ResetsUserPasswords
{
    /**
     * @param  Staff  $user
     * @param  array<string, string>  $input
     */
    public function reset($user, array $input): void
    {
        Validator::make($input, [
            'password' => ['required', 'string', Password::min(config()->integer('speedclub.passwords.min_length')), new NotPasswordHash, 'confirmed'],
        ])->validate();

        DB::transaction(function () use ($user, $input): void {
            $user->forceFill(['password' => Hash::make($input['password']), 'password_proof_required' => false])->save();
            StaffCredentials::rotate($user);

            Audit::record(StaffSecurityEvent::PasswordReset->value, $user, actor: $user);
        });
    }
}
