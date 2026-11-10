<?php

namespace App\Http\Middleware;

use App\Support\SignedInBrowser;
use App\Support\Viewer;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signed-in web users read /v and /u inside the member web app (05_ARCHITECTURE §4). Temporary, because the same URL serves
 * everybody else, and it never reaches a guest or a crawler, who send no session cookie.
 *
 * Only while speedclub.public_pages.redirect_members_to_app is on, which it is by default since VEH-01 exists in the app (ADR-148 i).
 * /u joined with PROF-02 (M2.1, ADR-176 f).
 *
 * ?view=public stays on the page: QR-04 promises a member the page strangers get. So whoever asks with it counts as a guest, also with a
 * Bearer token, the one thing Viewer would read here. It only ever yields what a guest already gets, so it exposes nothing, and the
 * canonical link of the page stays on the plain address.
 */
class RedirectMembersToApp
{
    /**
     * While this is off, /v shows a signed-in browser what it shows a guest, so /c decides where a scan goes for a guest as well.
     */
    public static function enabled(): bool
    {
        return config()->boolean('speedclub.public_pages.redirect_members_to_app');
    }

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->query('view') === 'public') {
            Viewer::treatAsGuest($request);

            return $next($request);
        }

        if (! self::enabled() || SignedInBrowser::member($request) === null) {
            return $next($request);
        }

        $query = $request->getQueryString();

        return redirect('/app/'.$request->path().($query === null ? '' : '?'.$query), 302);
    }
}
