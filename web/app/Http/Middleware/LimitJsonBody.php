<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * No JSON endpoint of ours takes more than a few KB: files arrive as multipart, which this leaves alone. A larger body costs far more
 * to decode and clean than it costs to send, on any route and ahead of every limit: TrimStrings is global, and an array of millions
 * of short values held a worker for seconds or ran out of memory with an empty 500 (SEC-P1-46, SEC-P1-48).
 *
 * The line is what fits the 256M that docs/DEPLOY.md asks of a host: at 512 KB the worst nested shape peaks at about 190 MB and gets its
 * 422, at 1 MB it ran out of memory in the validator.
 *
 * The first global middleware, so nothing else sees the request. The framework decodes earlier still, in Request::capture(), which
 * is why public/index.php captures through BoundedRequest. isJson() is the framework's own test, so this covers what it would decode.
 *
 * It answers itself: ApiExceptionRenderer covers /api only, and the locale middleware has not run yet.
 */
final class LimitJsonBody
{
    public const MAX_BYTES = 524288;

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! self::exceeds($request)) {
            return $next($request);
        }

        SetLocaleFromHeader::apply($request);
        $code = ErrorCode::PayloadTooLarge;

        return $request->expectsJson() || $request->is('api', 'api/*')
            ? new JsonResponse(['message' => $code->message(), 'code' => $code->value, 'errors' => (object) []], $code->status())
            : new Response($code->message(), $code->status(), ['Content-Type' => 'text/plain; charset=UTF-8']);
    }

    /**
     * The declared length when there is one. A chunked body has none, so that one is read, and never further than the line.
     */
    public static function exceeds(Request $request): bool
    {
        if (! $request->isJson()) {
            return false;
        }

        $declared = $request->server('CONTENT_LENGTH');

        if (is_numeric($declared)) {
            return (int) $declared > self::MAX_BYTES;
        }

        return strlen((string) stream_get_contents($request->getContent(true), self::MAX_BYTES + 1)) > self::MAX_BYTES;
    }
}
