<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Auth\StaffCredentials;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Alias staff.active. Runs on every staff request (AdminServiceProvider appends it to the "staff" group, so Fortify's routes and every
 * admin route have it), and reads the account fresh each time:
 *
 * - a suspended or deactivated account is signed out at once, not at its next sign-in (SEC-P1-25), audited;
 * - a session whose credentials epoch is stale is signed out (password changed or reset, second factor changed: StaffCredentials),
 *   audited;
 * - a pending TOTP challenge of an account that is no longer active is dropped, so the code alone cannot finish the sign-in after a
 *   suspension (SEC-P1-25, round 5);
 * - a guest who still carries the marker cookie of a signed-in session lost that session to the 30-minute idle limit: the sign-in page
 *   then shows "Deine Sitzung ist abgelaufen" (flash session_expired, ADR-217).
 */
final class EnsureStaffActive
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $staff = $request->user('staff');

        if (! $staff instanceof Staff) {
            $this->dropInactiveChallenge($request);
            $this->noticeExpiry($request);

            return $next($request);
        }

        if (! $staff->isActive()) {
            return $this->endSession($request, $staff, StaffSecurityEvent::SessionEndedInactive);
        }

        if (! StaffCredentials::holds($staff, $request->session())) {
            return $this->endSession($request, $staff, StaffSecurityEvent::SessionEndedCredentialsChanged);
        }

        return $next($request);
    }

    private function endSession(Request $request, Staff $staff, StaffSecurityEvent $event): Response
    {
        Audit::record($event->value, $staff, actor: $staff);

        Auth::guard('staff')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        $request->session()->flash('error', (string) __('staff_auth.session_ended'));
        Cookie::queue(Cookie::forget(config()->string('speedclub.staff.seen_cookie'), config()->string('speedclub.staff.session_path')));

        if ($request->expectsJson() && ! $request->header('X-Inertia')) {
            $code = ErrorCode::Unauthenticated;

            return new JsonResponse(['message' => (string) __('staff_auth.session_ended'), 'code' => $code->value, 'errors' => (object) []], $code->status());
        }

        return redirect()->to(route('login'), $request->isMethod('GET') ? 302 : 303);
    }

    private function dropInactiveChallenge(Request $request): void
    {
        if (! $request->hasSession() || ! $request->session()->has('login.id')) {
            return;
        }

        $pending = Staff::query()->find($request->session()->get('login.id'));

        if (! $pending instanceof Staff || ! $pending->isActive()) {
            $request->session()->forget(['login.id', 'login.remember']);
        }
    }

    private function noticeExpiry(Request $request): void
    {
        $cookie = config()->string('speedclub.staff.seen_cookie');

        if (! $request->cookies->has($cookie) || ! $request->hasSession()) {
            return;
        }

        // The sign-in page itself shows it now; any other page sends the guest there, where the flash is read.
        $request->routeIs('login')
            ? $request->session()->now('session_expired', true)
            : $request->session()->flash('session_expired', true);

        Cookie::queue(Cookie::forget($cookie, config()->string('speedclub.staff.session_path')));
    }
}
