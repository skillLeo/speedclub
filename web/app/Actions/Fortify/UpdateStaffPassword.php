<?php

namespace App\Actions\Fortify;

use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Rules\NotPasswordHash;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use App\Services\Auth\StaffPasswordCheck;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\UpdatesUserPasswords;

/**
 * PUT /admin/user/password (ADM-51). The current password goes through StaffPasswordCheck, which limits wrong answers per account
 * (SEC-P1-26). Every other session of the account ends with the change (SEC-P1-25): this one keeps the new credentials epoch.
 */
class UpdateStaffPassword implements UpdatesUserPasswords
{
    public function __construct(private readonly StaffPasswordCheck $passwords) {}

    /**
     * @param  Staff  $user
     * @param  array<string, string>  $input
     */
    public function update($user, array $input): void
    {
        Validator::make($input, [
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', Password::min(config()->integer('speedclub.passwords.min_length')), new NotPasswordHash, 'confirmed'],
        ])->validateWithBag('updatePassword');

        if (! $this->passwords->check($user, $input['current_password'], 'current_password')) {
            throw ValidationException::withMessages(['current_password' => [(string) __('validation.current_password')]])->errorBag('updatePassword');
        }

        DB::transaction(function () use ($user, $input): void {
            $user->forceFill(['password' => Hash::make($input['password'])])->save();
            StaffCredentials::rotate($user, session()->driver());

            Audit::record(StaffSecurityEvent::PasswordChanged->value, $user, actor: $user);
        });
    }
}
