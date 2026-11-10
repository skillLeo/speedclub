<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * No staff step needs more than a few short fields. Without a limit, an anonymous browser form stores every field in the session
 * row, and the limiters run Str::transliterate over the address before anything is validated (SEC-P1-43).
 *
 * Runs ahead of StartSession and ThrottleRequests (FortifyServiceProvider pins that), because the limiter's key and its own answer
 * read the input too. It sits on Fortify's routes only (config/fortify.php), so later admin pages can take long texts. Files are
 * not input here: they are never stored in the session.
 *
 * It answers itself instead of abort(): ApiExceptionRenderer covers /api only, so on /admin an exception would not end in
 * {message, code, errors}.
 */
final class LimitStaffStepInput
{
    private const MAX_BYTES = 16384;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (strlen(serialize($request->input())) <= self::MAX_BYTES) {
            return $next($request);
        }

        $code = ErrorCode::PayloadTooLarge;

        return $request->expectsJson()
            ? new JsonResponse(['message' => $code->message(), 'code' => $code->value, 'errors' => (object) []], $code->status())
            : new Response($code->message(), $code->status(), ['Content-Type' => 'text/plain; charset=UTF-8']);
    }
}
