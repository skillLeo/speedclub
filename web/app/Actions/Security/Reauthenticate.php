<?php

namespace App\Actions\Security;

use App\Actions\Auth\Passkeys\VerifyMemberPasskey;
use App\Enums\LoginPurpose;
use App\Enums\MemberSecurityEvent;
use App\Enums\PasskeyCeremony;
use App\Enums\ReauthMethod;
use App\Enums\SecurityNotice;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\EmailCodes;
use App\Services\Auth\Reauthentication;
use App\Services\Auth\RecentAuthentication;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * POST me/reauth (09 §8.1 "sudo mode"): proves the signed-in member again and stamps this token or browser session for 10 minutes.
 * passkey: an assertion of the member's own passkey (ceremony from POST me/reauth/passkey-options), no second factor. email_code: the code
 * of POST me/reauth/email. password: the account's password. With two-factor on, email_code and password also need `two_factor_code`
 * (TOTP or recovery code), counted in the one second-factor budget. Wrong answers are 422 on their field.
 */
class Reauthenticate
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly RecentAuthentication $recent,
        private readonly EmailCodes $codes,
        private readonly VerifyMemberPasskey $passkeys,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @param  array{password?: string|null, attempt_id?: string|null, code?: string|null, ceremony_id?: string|null, credential?: array<string, mixed>|null, two_factor_code?: string|null}  $input
     */
    public function handle(User $user, ReauthMethod $method, array $input, Request $request): CarbonImmutable
    {
        match ($method) {
            ReauthMethod::Passkey => $this->passkeys->handle(PasskeyCeremony::Reauth, (string) ($input['ceremony_id'] ?? ''), $input['credential'] ?? [], $user),
            ReauthMethod::EmailCode => $this->codes->consume($user->email, (string) ($input['attempt_id'] ?? ''), LoginPurpose::Reauth, (string) ($input['code'] ?? ''), null, fn (): bool => true, function () use ($user): void {
                Audit::record(MemberSecurityEvent::EmailCodeLocked->value, $user, actor: $user);
                $this->notifier->security($user, SecurityNotice::EmailCodeLocked);
            }),
            ReauthMethod::Password => $this->password($user, (string) ($input['password'] ?? '')),
        };

        if ($method !== ReauthMethod::Passkey) {
            $this->secondFactor($user, $input['two_factor_code'] ?? null);
        }

        $at = $this->recent->mark($user, $request);
        Audit::record(MemberSecurityEvent::Reauthenticated->value, $user, after: ['method' => $method->value], actor: $user);

        return $at->addMinutes(config()->integer('speedclub.reauth.recent_minutes'));
    }

    /**
     * Never the recent-auth shortcut of Reauthentication::password(): this is the proof itself.
     */
    private function password(User $user, string $password): void
    {
        if (! $user->hasPassword()) {
            throw ValidationException::withMessages(['password' => [(string) __('settings.password_wrong')]]);
        }

        $this->reauth->password($user, $password === '' ? ' ' : $password);
    }

    private function secondFactor(User $user, ?string $code): void
    {
        try {
            $this->reauth->secondFactor($user, $code);
        } catch (ValidationException $exception) {
            throw ValidationException::withMessages(['two_factor_code' => $exception->errors()['code'] ?? [(string) __('settings.code_wrong')]]);
        }
    }
}
