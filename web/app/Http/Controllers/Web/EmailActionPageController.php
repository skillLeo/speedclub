<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Http\Middleware\PublicPageContext;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-07 /email/{action} (m2.7-contract §2): the landing of an e-mail link opened on a desktop or a phone without the app, for `verify` and
 * `reset`. Sessionless (ADR-115). The code and the address travel in the fragment (ADR-138), which browsers never send, so they reach no
 * request, query string or log here: the page's own script moves them into the links that may carry them and clears the address bar.
 * Without JavaScript both links open the screen without a code, where the six digits of the mail can be typed.
 *
 * "In der App öffnen" never hands the code to the custom scheme (SEC-P2-03): any Android app may claim speedclub://, and on a phone
 * without SPEED CLUB, the case this page serves, such an app would get the reset code and the address. Where App Links are verified
 * (staging and production on https), the button is the https link /app/reset-password or /app/verify-email with the fragment, an exact
 * path of assetlinks and apple-app-site-association that only the installed app can take and that otherwise opens the member web.
 * Elsewhere it is the bare scheme link, and the member types the code in the app.
 */
class EmailActionPageController extends Controller
{
    /** action => app route */
    public const ACTIONS = ['verify' => 'verify-email', 'reset' => 'reset-password'];

    public function __invoke(Request $request, string $action): Response
    {
        $route = self::ACTIONS[$action] ?? null;

        if ($route === null) {
            abort(404);
        }

        // Nothing but the language belongs in the query: a code put there by mistake must not be copied into the footer's links. Outside
        // production the QA overrides of the screenshot matrix (07_QA_AND_RELEASE §3) stay too, as on every other public page; only
        // their plain string values are kept.
        $allowed = app()->environment('production') ? ['lang'] : ['lang', ...PublicPageContext::QA_KEYS];
        $query = $request->query();

        if (array_diff(array_keys($query), $allowed) !== [] || array_filter($query, fn (mixed $value): bool => ! is_string($value)) !== []) {
            $kept = array_filter(
                array_intersect_key($query, array_flip($allowed)),
                fn (mixed $value): bool => is_string($value),
            );

            return redirect('/email/'.$action.($kept !== [] ? '?'.http_build_query($kept) : ''), 302, ['Cache-Control' => 'no-store']);
        }

        $verified = self::appLinksVerified();

        return response()->view('public.email-action', [
            'action' => $action,
            'browser' => url('/app/'.$route),
            'app' => $verified ? url('/app/'.$route) : 'speedclub://'.$route,
            'appCarriesCode' => $verified,
        ])->header('Cache-Control', 'no-store');
    }

    /**
     * Whether this host's https links open the installed app as verified App Links and universal links: only the staging and production
     * hosts publish the association files the app was built for, and only over https.
     */
    public static function appLinksVerified(): bool
    {
        return app()->environment(['staging', 'production']) && str_starts_with(config()->string('app.url'), 'https://');
    }
}
