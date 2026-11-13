<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Support\ViewAs;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * View-as is read-only and never shows messages (m3.2-contract §3, 06_ADMIN_SPEC §3). On every api/v1 route, ahead of authentication,
 * route bindings and limiters, for a request whose bearer is a view-as token (ViewAs::tokenOf, whether or not the route signs in):
 *
 * - a message route (conversations, messages, chat media, the realtime channel auth, the unread counts that hold message counts, and the
 *   data export, which carries the member's messages): 403 `view_as_no_messages`, whatever the method;
 * - any other method than GET, HEAD or OPTIONS: 403 `view_as_read_only`; the one exception is `DELETE api/v1/view-as`, which ends it;
 * - a read of the member's maintenance, service log, odometer or private cost totals (M4.13 ruling, ADR-441): 403 `view_as_private`;
 * - first of all, a token whose staff member is no longer active: 401 `unauthenticated` (SEC-P3-07).
 *
 * Writers that run on GETs skip a view-as request themselves (ViewAs::active(): activity counters, QR scans, reset codes).
 */
class RestrictViewAs
{
    /** Paths whose answers contain messages, message counts or previews. */
    public const MESSAGE_PATHS = [
        'api/v1/conversations', 'api/v1/conversations/*',
        'api/v1/messages', 'api/v1/messages/*',
        'api/v1/chat-media', 'api/v1/chat-media/*',
        'api/v1/broadcasting/*',
        'api/v1/notifications/unread-count',
        'api/v1/me/exports', 'api/v1/me/exports/*', 'api/v1/me/export',
    ];

    /** M4.13 (ADR-441): maintenance and private costs, which view-as never shows. */
    public const PRIVATE_PATHS = [
        'api/v1/me/maintenance', 'api/v1/me/maintenance/*',
        'api/v1/vehicles/*/maintenance-items', 'api/v1/vehicles/*/maintenance-items/*',
        'api/v1/vehicles/*/maintenance-logs', 'api/v1/vehicles/*/maintenance-logs/*',
        'api/v1/vehicles/*/costs', 'api/v1/vehicles/*/odometer',
        'api/v1/maintenance-media/*',
    ];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->is('api/*') ? ViewAs::tokenOf($request) : null;

        if ($token === null) {
            return $next($request);
        }

        // The staff member who started it is no longer active (suspended, deactivated, gone): the token is worth nothing (SEC-P3-07).
        if (! ViewAs::staffStillActive($token)) {
            throw new ApiException(ErrorCode::Unauthenticated);
        }

        if ($request->is(...self::MESSAGE_PATHS)) {
            throw new ApiException(ErrorCode::ViewAsNoMessages);
        }

        if (! in_array($request->getMethod(), ['GET', 'HEAD', 'OPTIONS'], true) && ! ($request->isMethod('DELETE') && $request->is('api/v1/view-as'))) {
            throw new ApiException(ErrorCode::ViewAsReadOnly);
        }

        if ($request->is(...self::PRIVATE_PATHS)) {
            throw new ApiException(ErrorCode::ViewAsPrivate);
        }

        return $next($request);
    }
}
