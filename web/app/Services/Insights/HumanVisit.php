<?php

namespace App\Services\Insights;

use App\Http\Middleware\PublicPageContext;
use App\Support\KnownBots;
use Illuminate\Http\Request;

/**
 * M5.7 (m5.7-contract §2.1): whether a request is a person looking, for the view count. Prefetches and prerenders are not (the
 * `Purpose`, `Sec-Purpose`, `X-Purpose` and `X-Moz` headers), nor, outside production, the QA matrix's renders (a qa* override in the
 * query or in the same-origin Referer, as App\Services\Businesses\BusinessViews). Pages also leave out every machine of KnownBots; the
 * app's beacon only browser automation, since the app itself sends okhttp (Android) or CFNetwork (iOS) as its user agent.
 */
final class HumanVisit
{
    private const AUTOMATION = '~headless|playwright|puppeteer|selenium|phantomjs|lighthouse|webdriver~i';

    public static function page(Request $request): bool
    {
        return ! KnownBots::matches($request->userAgent()) && self::common($request);
    }

    public static function beacon(Request $request): bool
    {
        return preg_match(self::AUTOMATION, (string) $request->userAgent()) !== 1 && self::common($request);
    }

    private static function common(Request $request): bool
    {
        foreach (['Purpose', 'Sec-Purpose', 'X-Purpose', 'X-Moz'] as $header) {
            $value = strtolower((string) $request->header($header));

            if (str_contains($value, 'prefetch') || str_contains($value, 'prerender')) {
                return false;
            }
        }

        return ! self::qaRender($request);
    }

    private static function qaRender(Request $request): bool
    {
        if (app()->environment('production')) {
            return false;
        }

        $keys = array_keys($request->query());
        $referer = parse_url((string) $request->headers->get('referer'), PHP_URL_QUERY);

        if (is_string($referer)) {
            foreach (explode('&', $referer) as $pair) {
                $keys[] = urldecode(explode('=', $pair, 2)[0]);
            }
        }

        return array_intersect(PublicPageContext::QA_KEYS, $keys) !== [];
    }
}
