<?php

namespace App\Actions\Auth;

use App\Enums\MemberSecurityEvent;
use App\Enums\RestrictionType;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Admin\Kpi\ActivityTracker;
use App\Services\Audit\Audit;
use App\Services\Auth\KnownDevices;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactorChallenges;
use App\Services\Notifications\Notifier;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use App\Support\Auth\TwoFactorPending;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The one way into an account (05_ARCHITECTURE §7): with a device a Sanctum token for that device, otherwise the SPA
 * session. FormRequests already answered 419 when neither is possible (ADR-124).
 */
class SignInMember
{
    public function __construct(
        private readonly KnownDevices $devices,
        private readonly Notifier $notifier,
        private readonly IssueDeviceToken $tokens,
        private readonly DemandPasswordChange $passwordChange,
        private readonly TwoFactorChallenges $challenges,
        private readonly SecondFactorGuard $secondFactor,
    ) {}

    /**
     * The first factor is proved (login, e-mail verify). With two-factor on, a challenge instead of a session (AUTH-11); the new-device
     * notice and the forced password change wait for the second factor, so a wrong code learns nothing about either.
     */
    public function begin(User $user, ?DeviceInfo $device, Request $request): AuthResult|TwoFactorPending
    {
        self::ensureMayEnter($user);

        if ($user->hasTwoFactor()) {
            // Too many wrong second factors: no new challenge until a password reset by e-mail code (SecondFactorGuard).
            $this->secondFactor->ensureAllowed($user);

            return new TwoFactorPending($this->challenges->issue($user, $device, $request), TwoFactorChallenges::TTL_SECONDS);
        }

        return $this->handle($user, $device, $request);
    }

    public function handle(User $user, ?DeviceInfo $device, Request $request): AuthResult
    {
        self::ensureMayEnter($user);

        if ($user->getAttribute('force_password_change') === true) {
            $this->passwordChange->atSignIn($user);
        }

        $fingerprint = $device?->fingerprint() ?? $this->devices->browserFingerprint($request);

        $result = DB::transaction(function () use ($user, $device, $request, $fingerprint): AuthResult {
            $result = $device === null
                ? $this->startSession($user, $request)
                : $this->tokens->handle($user, $device);

            // Counts the member for the admin's DAU/MAU (ADR-216) when this is their first sign-in of a day or month.
            app(ActivityTracker::class)->seen($user, signIn: true);

            // Nobody has proved this address yet, so its mailbox may be a stranger's: no mail, and no devices to compare with.
            if ($user->hasVerifiedEmail() && $this->devices->remember($user, $fingerprint)) {
                Audit::record(MemberSecurityEvent::LoginNewDevice->value, $user, after: [
                    'device_name' => $device?->name,
                    'platform' => $device?->platform,
                    'app_version' => $device?->appVersion,
                ], actor: $user);

                $this->notifyOwner($user, $device);
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
     * Bounded per account, so a stolen password cannot flood the owner either. The audit event is written regardless.
     */
    private function notifyOwner(User $user, ?DeviceInfo $device): void
    {
        $key = 'new-device-notice:'.$user->getKey();

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.known_devices.max_notices_per_hour'))) {
            return;
        }

        RateLimiter::hit($key, 3600);

        // The mandatory mail and the in-app row of HOME-02 (02_PRODUCT_SPEC §7).
        $this->notifier->security($user, SecurityNotice::NewDevice, $device?->name);
    }

    /**
     * The guard migrates the session id; regenerate() also replaces the CSRF token (session fixation).
     */
    private function startSession(User $user, Request $request): AuthResult
    {
        Auth::guard('web')->login($user);
        $request->session()->regenerate();

        return new AuthResult($user);
    }
}
