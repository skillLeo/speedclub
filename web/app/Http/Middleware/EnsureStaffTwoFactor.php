<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Symfony\Component\HttpFoundation\Response;

/**
 * TOTP is mandatory for staff (06_ADMIN_SPEC §1, ADM-03, SEC-P1-01). A signed-in staff account whose TOTP is not confirmed
 * reaches only the steps of ENROLMENT_ROUTES; every other request goes to enrolment: a redirect for the browser and Inertia,
 * 409 two_factor_required for a JSON client. A confirmed account gets 403 on the steps of CLOSED_ONCE_CONFIRMED.
 *
 * The account's state alone does not say that this session showed a code. A session marked SIGNED_IN_WITHOUT_CODE
 * (FortifyServiceProvider) is ended as soon as the account has confirmed TOTP, and has to come back through the challenge
 * (SEC-P1-32). The audit row is the only trace that such a session was open when the owner enrolled.
 *
 * Without a staff session it does nothing, so it may run ahead of auth:staff: guests are left to that middleware. It sits on
 * every Fortify route (config/fortify.php) and on every signed-in route in routes/admin (StaffAccessHardeningTest checks the
 * route table).
 */
final class EnsureStaffTwoFactor
{
    /** ADM-03 (route admin.two-factor.setup). */
    public const ENROLMENT_PATH = 'admin/two-factor/setup';

    /** A hash of the pending secret this session started (EnableStaffTwoFactor), SEC-P1-33. */
    public const PENDING_SECRET = 'staff.pending_two_factor';

    /** The steps that read or confirm a pending secret: only the session that started the enrolment may use them (SEC-P1-33). */
    public const PENDING_SECRET_ROUTES = [
        'two-factor.confirm',
        'two-factor.qr-code',
        'two-factor.secret-key',
    ];

    /**
     * Set by ConfirmStaffTwoFactor in the session that just confirmed TOTP: ADM-03 may read the recovery codes once, right after the
     * confirmation that proved a code (SEC-P1-36). Every later read or regeneration goes through ADM-51, which asks for a current code.
     */
    public const RECOVERY_CODES_ONCE = 'staff.recovery_codes_once';

    /** This session signed in without showing a code and has not shown one since. */
    public const SIGNED_IN_WITHOUT_CODE = 'staff.signed_in_without_code';

    /**
     * Sign-out, the Fortify enrolment steps, the password confirmation they require, and the ADM-03 page itself.
     * Recovery codes, disabling and the password change stay closed until TOTP is confirmed.
     */
    public const ENROLMENT_ROUTES = [
        'logout',
        'two-factor.enable',
        'two-factor.confirm',
        'two-factor.qr-code',
        'two-factor.secret-key',
        'password.confirm',
        'password.confirm.store',
        'password.confirmation',
        'admin.two-factor.setup',
    ];

    /**
     * Once TOTP is confirmed these steps would replace, remove or copy it, and a password confirmation does not prove the second
     * factor (SEC-P1-22). ADM-51 replaces them with steps that ask for a current code (App\Actions\Admin\Account: rotation, recovery
     * codes; SEC-P1-36, SEC-P1-39). two-factor.confirm too: on a confirmed account it would only be an unlimited test of the current
     * code (SEC-P1-34). Fortify's recovery-code read is open once, to the session that has just confirmed (RECOVERY_CODES_ONCE).
     */
    public const CLOSED_ONCE_CONFIRMED = [
        'two-factor.enable',
        'two-factor.confirm',
        'two-factor.disable',
        'two-factor.secret-key',
        'two-factor.qr-code',
        'two-factor.recovery-codes',
        'two-factor.regenerate-recovery-codes',
    ];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $staff = $request->user('staff');

        if (! $staff instanceof Staff) {
            return $next($request);
        }

        $route = $request->route()?->getName();

        if ($staff->hasEnabledTwoFactorAuthentication()) {
            if ($request->session()->get(self::SIGNED_IN_WITHOUT_CODE) === true) {
                return $this->endSession($request, $staff);
            }

            if (! in_array($route, self::CLOSED_ONCE_CONFIRMED, true)) {
                return $next($request);
            }

            if ($route === 'two-factor.recovery-codes' && $request->session()->pull(self::RECOVERY_CODES_ONCE) === true) {
                Audit::record(StaffSecurityEvent::RecoveryCodesViewed->value, $staff, after: ['via' => 'enrolment'], actor: $staff);

                return $next($request);
            }

            return $this->jsonOrStatus($request, ErrorCode::Forbidden);
        }

        if (in_array($route, self::PENDING_SECRET_ROUTES, true) && ! $this->startedHere($request, $staff)) {
            return $this->jsonOrStatus($request, ErrorCode::Conflict);
        }

        if (in_array($route, self::ENROLMENT_ROUTES, true) || $request->is(self::ENROLMENT_PATH)) {
            return $next($request);
        }

        $enrolment = url(self::ENROLMENT_PATH);

        if ($request->expectsJson()) {
            return $this->jsonError(ErrorCode::TwoFactorRequired, ['enrolment_url' => $enrolment]);
        }

        return $this->redirectTo($request, $enrolment);
    }

    /**
     * The hash of the stored secret, as EnableStaffTwoFactor keeps it in the session. Of the ciphertext: no secret is decrypted for it.
     */
    public static function secretFingerprint(Staff $staff): string
    {
        return hash('sha256', (string) $staff->getRawOriginal('two_factor_secret', $staff->getAttribute('two_factor_secret')));
    }

    /**
     * Whether this session started the pending enrolment. Without a pending secret there is nothing to read; Fortify answers that.
     */
    private function startedHere(Request $request, Staff $staff): bool
    {
        if (empty($staff->two_factor_secret)) {
            return true;
        }

        $held = $request->session()->get(self::PENDING_SECRET);

        return is_string($held) && hash_equals(self::secretFingerprint($staff), $held);
    }

    private function jsonOrStatus(Request $request, ErrorCode $code): Response
    {
        abort_unless($request->expectsJson(), $code->status());

        return $this->jsonError($code);
    }

    private function endSession(Request $request, Staff $staff): Response
    {
        Audit::record(StaffSecurityEvent::SessionEndedWithoutCode->value, $staff, actor: $staff);

        Auth::guard('staff')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return $request->expectsJson()
            ? $this->jsonError(ErrorCode::Unauthenticated)
            : $this->redirectTo($request, route('login'));
    }

    /** 303 after a write, so that Inertia follows with a GET. */
    private function redirectTo(Request $request, string $url): Response
    {
        return redirect()->to($url, $request->isMethod('GET') ? 302 : 303);
    }

    /**
     * @param  array<string, string>  $extra
     */
    private function jsonError(ErrorCode $code, array $extra = []): JsonResponse
    {
        return new JsonResponse([
            'message' => $code->message(),
            'code' => $code->value,
            'errors' => (object) [],
            ...$extra,
        ], $code->status());
    }
}
