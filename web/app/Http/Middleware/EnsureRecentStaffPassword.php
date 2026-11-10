<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Alias staff.recent-password (ADR-215). A sensitive admin write needs a password confirmed (Fortify password.confirm.store) within
 * speedclub.staff.recent_password_seconds. A stale confirmation does not redirect to a page, which would turn an Inertia POST into a
 * lost GET: the request is refused before the controller runs, so nothing changes, and goes back with the flash confirm_password. The
 * page asks for the password in a dialog and repeats the action. A JSON client gets 403 password_confirmation_required.
 */
final class EnsureRecentStaffPassword
{
    public const SESSION_KEY = 'auth.password_confirmed_at';

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (self::isRecent($request)) {
            return $next($request);
        }

        if ($request->expectsJson() && ! $request->header('X-Inertia')) {
            $code = ErrorCode::PasswordConfirmationRequired;

            return new JsonResponse(['message' => $code->message(), 'code' => $code->value, 'errors' => (object) []], $code->status());
        }

        return back($request->isMethod('GET') ? 302 : 303)->with('confirm_password', true);
    }

    public static function isRecent(Request $request): bool
    {
        if (! $request->hasSession()) {
            return false;
        }

        $confirmedAt = $request->session()->get(self::SESSION_KEY);

        return is_numeric($confirmedAt)
            && time() - (int) $confirmedAt < config()->integer('speedclub.staff.recent_password_seconds');
    }
}
