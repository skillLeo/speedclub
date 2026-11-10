<?php

namespace App\Actions\Me;

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\Reauthentication;
use App\Services\Notifications\Notifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * SET-04. The device of this request stays signed in. Other browsers end with any password change (Sanctum's AuthenticateSession
 * compares the password hash in their session); app tokens on other devices end only with revoke_other_sessions. 02_PRODUCT_SPEC §3.1
 * policy through MemberPassword; same as now and the username are refused here, after the current password was proved.
 */
class ChangePassword
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly DeviceSessions $sessions,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $user, string $current, string $password, bool $revokeOthers, Request $request, ?string $code = null): void
    {
        $this->reauth->password($user, $current, 'current_password');
        // With two-factor on, a current code as well (SEC-P2-07).
        $this->reauth->secondFactorForChange($user, $code);

        if (hash_equals($current, $password)) {
            throw ValidationException::withMessages(['password' => [(string) __('passwords.rules.same_as_current')]]);
        }

        if ($user->username !== null && mb_strtolower($password) === $user->username) {
            throw ValidationException::withMessages(['password' => [(string) __('passwords.rules.same_as_username')]]);
        }

        DB::transaction(function () use ($user, $password, $revokeOthers, $request): void {
            $user->forceFill([
                'password' => Hash::make($password),
                'force_password_change' => false,
                'remember_token' => Str::random(60),
            ])->save();

            // Other browsers end with any password change; app tokens only on request.
            $revoked = $revokeOthers
                ? $this->sessions->revokeOthers($user, $request)
                : ['devices' => 0, 'sessions' => $this->sessions->endOtherBrowsers($user, $request)];

            Audit::record(MemberSecurityEvent::PasswordChanged->value, $user, after: ['signed_out_others' => $revokeOthers, ...$revoked], actor: $user);
        });

        $token = $user->currentAccessToken();
        $device = $token instanceof PersonalAccessToken ? $token->deviceName() : null;

        $this->notifier->security($user, SecurityNotice::PasswordChanged, $device, variant: $revokeOthers ? 'others_signed_out' : 'kept');

    }
}
