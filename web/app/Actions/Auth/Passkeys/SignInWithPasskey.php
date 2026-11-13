<?php

namespace App\Actions\Auth\Passkeys;

use App\Actions\Auth\SignInMember;
use App\Enums\PasskeyCeremony;
use App\Enums\SignInMethod;
use App\Services\Auth\Passkeys\MemberWebAuthn;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\PasswordlessResult;
use Illuminate\Http\Request;

/**
 * POST auth/passkeys/verify (09 §8.2): a usernameless assertion signs in the passkey's owner with a token (or the web session). Two-factor
 * is skipped (09 §8.1). A closed account answers like an unknown passkey.
 */
class SignInWithPasskey
{
    public function __construct(
        private readonly VerifyMemberPasskey $verify,
        private readonly SignInMember $signIn,
    ) {}

    /**
     * @param  array<string, mixed>  $credential
     */
    public function handle(string $ceremonyId, array $credential, ?DeviceInfo $device, Request $request): PasswordlessResult
    {
        $passkey = $this->verify->handle(PasskeyCeremony::Authentication, $ceremonyId, $credential);
        $user = $passkey->user;

        if ($user === null || $user->isPendingDeletion() || $user->isDeactivated()) {
            throw MemberWebAuthn::invalid();
        }

        return new PasswordlessResult($this->signIn->handle($user, $device, $request, method: SignInMethod::Passkey), false);
    }
}
