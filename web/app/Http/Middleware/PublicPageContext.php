<?php

namespace App\Http\Middleware;

use App\Services\Privacy\OrgIdentity;
use App\Support\KnownBots;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Language of a public Blade page: ?lang= from the footer's DE/EN, otherwise Accept-Language, otherwise German. No cookie, because a
 * guest gets none (ADR-115). Outside production it also applies the QA overrides of 07_QA_AND_RELEASE §3, which the layout
 * reports on <html> for the screenshot matrix.
 *
 * qaNow counts as an override but never moves the server's clock: rate limits, suspensions and the 14 days of an old username
 * read that clock, and any visitor of a staging host could otherwise switch them off. These pages print no moment relative to
 * now (dates are absolute), so the matrix needs only the browser clock it freezes itself.
 */
class PublicPageContext
{
    private const STATES = ['default', 'loading', 'empty', 'error', 'offline'];

    /** The query keys of the QA overrides (07_QA_AND_RELEASE §3), honoured outside production only. */
    public const QA_KEYS = ['qaTheme', 'qaLocale', 'qaFontScale', 'qaState', 'qaMotion', 'qaNow'];

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $this->locale($request);
        $qa = self::qa($request);

        // A server-rendered page has one failure of its own to show: the server not answering. Loading and offline do not exist here.
        $response = ($qa['state'] ?? null) === 'error'
            ? response()->view('public.state', ['state' => 'server_error'])
            : $next($request);

        $response->headers->set('Content-Language', $locale);
        $response->setVary('Accept-Language', false);

        return $response;
    }

    /**
     * What the layout writes onto <html>. Null in production and when no override is present.
     *
     * @return array{theme: string, locale: string, font_scale: string, state: string, motion: string}|null
     */
    public static function qa(Request $request): ?array
    {
        if (app()->environment('production') || array_intersect(self::QA_KEYS, array_keys($request->query())) === []) {
            return null;
        }

        $theme = $request->query('qaTheme');
        $state = $request->query('qaState');

        return [
            'theme' => in_array($theme, ['carbon', 'black', 'light'], true) ? $theme : 'system',
            'locale' => app()->getLocale(),
            'font_scale' => $request->query('qaFontScale') === '2' ? '2' : '1',
            'state' => in_array($state, self::STATES, true) ? $state : 'default',
            'motion' => $request->query('qaMotion') === 'off' ? 'off' : 'on',
        ];
    }

    private function locale(Request $request): string
    {
        /** @var list<string> $supported */
        $supported = config('speedclub.locales');

        $asked = app()->environment('production') ? null : $request->query('qaLocale');
        $asked ??= $request->query('lang');

        // ADR-239: without a matching browser language the org's default locale. A link-preview fetcher (KnownBots) speaks for whoever
        // shared the link, not for itself: facebookexternalhit asks for en-US, so it gets the org's language unless the link says ?lang=.
        $locale = match (true) {
            in_array($asked, $supported, true) => $asked,
            KnownBots::matches($request->userAgent()) => app(OrgIdentity::class)->defaultLocale(),
            default => app(OrgIdentity::class)->forRequest($request),
        };
        app()->setLocale($locale);

        return $locale;
    }
}
