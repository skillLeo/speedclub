<?php

namespace App\Actions\Auth;

use App\Enums\DevicePlatform;
use App\Enums\MemberSecurityEvent;
use App\Enums\RestrictionType;
use App\Enums\SignInMethod;
use App\Exceptions\ApiException;
use App\Models\DeviceInstall;
use App\Models\User;
use App\Services\Admin\Kpi\ActivityTracker;
use App\Services\Audit\Audit;
use App\Services\Auth\DeviceInstalls;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\KnownDevices;
use App\Services\Auth\RecentAuthentication;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\SecondFactorProof;
use App\Services\Auth\TwoFactorChallenges;
use App\Services\Security\LoginAlerts;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * The one way into an account (05_ARCHITECTURE §7): with a device a Sanctum token for that device, otherwise the SPA
 * session. FormRequests already answered 419 when neither is possible (ADR-124).
 */
class SignInMember
{
    public function __construct(
        private readonly KnownDevices $devices,
        private readonly IssueDeviceToken $tokens,
        private readonly DemandPasswordChange $passwordChange,
        private readonly TwoFactorChallenges $challenges,
        private readonly SecondFactorGuard $secondFactor,
        private readonly DeviceInstalls $installs,
        private readonly LoginAlerts $alerts,
    ) {}

    /**
     * The first factor is proved (login, e-mail verify). With two-factor on, a challenge instead of a session (AUTH-11); the new-device
     * notice and the forced password change wait for the second factor, so a wrong code learns nothing about either.
     *
     * $pending travels encrypted inside the challenge and is applied only once the second factor passed (PassTwoFactorChallenge), e.g. a
     * provider link of AUTH-16 (SEC-M46-02).
     *
     * @param  array<string, mixed>  $pending
     * @param  SignInMethod|null  $method  the first proof, for SET-21 (09 §8.4); kept in the challenge for the second factor
     */
    public function begin(User $user, ?DeviceInfo $device, Request $request, array $pending = [], ?SignInMethod $method = null): AuthResult|TwoFactorPending
    {
        self::ensureMayEnter($user);

        if ($user->hasTwoFactor()) {
            // Too many wrong second factors: no new challenge until a password reset by e-mail code (SecondFactorGuard).
            $this->secondFactor->ensureAllowed($user);

            $pending = $method === null ? $pending : [...$pending, 'method' => $method->value];

            return new TwoFactorPending($this->challenges->issue($user, $device, $request, $pending), TwoFactorChallenges::TTL_SECONDS);
        }

        return $this->handle($user, $device, $request, method: $method);
    }

    /**
     * Every sign-in is a SET-21 row (09 §8.4): `member.signed_in`, or `member.login_new_device` for an install or browser this account
     * has not used before, which also sends the login alert.
     *
     * @param  bool  $secondFactorPassed  this sign-in passed AUTH-11 (SecondFactorProof)
     */
    public function handle(User $user, ?DeviceInfo $device, Request $request, bool $secondFactorPassed = false, ?SignInMethod $method = null): AuthResult
    {
        self::ensureMayEnter($user);

        if ($user->getAttribute('force_password_change') === true) {
            $this->passwordChange->atSignIn($user);
        }

        // SEC-M47-03: from here on the install id exists only in its keyed form.
        $device = $device?->keyedFor($user);
        // SEC-M47-02: a browser is its own random id (KnownDevices), not its user agent.
        $fingerprint = $device?->fingerprint() ?? $this->devices->browserFingerprint($user, $request);

        $result = DB::transaction(function () use ($user, $device, $request, $fingerprint, $secondFactorPassed, $method): AuthResult {
            $result = $device === null
                ? $this->startSession($user, $request, $secondFactorPassed)
                : $this->tokens->handle($user, $device, $secondFactorPassed);

            // Counts the member for the admin's DAU/MAU (ADR-216) when this is their first sign-in of a day or month.
            app(ActivityTracker::class)->seen($user, signIn: true);

            // Nobody has proved this address yet, so its mailbox may be a stranger's: no mail, and no devices to compare with.
            $isNew = $user->hasVerifiedEmail() && $this->devices->remember($user, $fingerprint);
            $install = $device?->id === null ? null : $this->installs->find($user, $device->id);

            Audit::record(($isNew ? MemberSecurityEvent::LoginNewDevice : MemberSecurityEvent::SignedIn)->value, $user, after: [
                'method' => $method?->value,
                'second_factor' => $secondFactorPassed,
                'device_name' => $device !== null ? $device->name : DeviceSessions::browserName((string) $request->userAgent()),
                'platform' => $device !== null ? $device->platform : DevicePlatform::Web,
                'app_version' => $device?->appVersion,
                'device_install_id' => $install?->id,
            ], actor: $user);

            if ($isNew) {
                $this->notifyOwner($user, $device, $install);
            }

            return $result;
        });

        return $result;
    }

    /**
     * Only asked after the password or the code was right, so the answer reveals nothing to a stranger. A closed account (deletion
     * requested) never gets here from auth/login, which answers it like a wrong password (LoginMember).
     */
    public static function ensureMayEnter(User $user): void
    {
        if ($user->isDeactivated() || $user->isSuspended()) {
            throw ApiException::accountRestricted($user->restrictedUntil(RestrictionType::Publishing));
        }
    }

    /**
     * The login alert of 09 §8.4 (mail, HOME-02 row, push to the other devices), bounded per account by LoginAlerts. The audit event is
     * written regardless.
     */
    private function notifyOwner(User $user, ?DeviceInfo $device, ?DeviceInstall $install): void
    {
        $this->alerts->newDevice($user, $device?->name, $install, $device?->id);
    }

    /**
     * The guard migrates the session id; regenerate() also replaces the CSRF token (session fixation).
     */
    private function startSession(User $user, Request $request, bool $secondFactorPassed): AuthResult
    {
        Auth::guard('web')->login($user);
        $request->session()->regenerate();
        $request->session()->put(RecentAuthentication::SESSION_KEY, now()->getTimestamp());

        if ($secondFactorPassed) {
            $request->session()->put(SecondFactorProof::SESSION_KEY, now()->getTimestamp());
        } else {
            $request->session()->forget(SecondFactorProof::SESSION_KEY);
        }

        return new AuthResult($user);
    }
}
