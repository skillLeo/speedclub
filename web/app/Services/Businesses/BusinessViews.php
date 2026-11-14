<?php

namespace App\Services\Businesses;

use App\Http\Middleware\PublicPageContext;
use App\Models\Business;
use App\Models\BusinessViewDay;
use App\Models\User;
use App\Support\KnownBots;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * BIZ-03 "Profilaufrufe 30 Tage" (09 §7.11), private to the business team: one number per business and day, counted with the
 * page view; the team's own views and samples are not counted, nor are machines (KnownBots), prefetches and, outside production,
 * the QA matrix's renders (DQ-1148: its captures of BIZ-01 and /b/{slug} carry the qa* overrides, so they never move BIZ-03's number).
 * No viewer, address or cookie is stored. speedclub:prune-platform removes days older than views_retention_days.
 */
final class BusinessViews
{
    public function record(Business $business, ?User $viewer, Request $request): void
    {
        if ($business->is_sample || ! $business->isPublic() || ($viewer !== null && $business->roleOf($viewer) !== null) || ! self::counts($request)) {
            return;
        }

        $day = CarbonImmutable::now(config()->string('speedclub.display_timezone'))->toDateString();

        // One upsert on a unique key: cheap enough to run in the request (no queue worker on shared hosting).
        BusinessViewDay::query()->upsert([['business_id' => $business->id, 'day' => $day, 'views' => 1]], ['business_id', 'day'], ['views' => DB::raw('views + 1')]);
    }

    public function lastDays(Business $business, ?int $days = null): int
    {
        $days ??= config()->integer('speedclub.businesses.views_days');
        $from = CarbonImmutable::now(config()->string('speedclub.display_timezone'))->subDays($days - 1)->toDateString();

        return (int) BusinessViewDay::query()->where('business_id', $business->id)->where('day', '>=', $from)->sum('views');
    }

    /**
     * A person's view: not a machine, not a prefetch, not a QA render.
     */
    private static function counts(Request $request): bool
    {
        if (KnownBots::matches($request->userAgent())) {
            return false;
        }

        foreach (['Purpose', 'Sec-Purpose', 'X-Purpose', 'X-Moz'] as $header) {
            if (str_contains(strtolower((string) $request->header($header)), 'prefetch')) {
                return false;
            }
        }

        return ! self::qaRender($request);
    }

    /**
     * Outside production, a page opened with a qa* override (07_QA_AND_RELEASE §3): /b/{slug} itself, or the app page whose API call this
     * is (the same-origin Referer keeps the query under strict-origin-when-cross-origin). In production the overrides do not exist.
     */
    private static function qaRender(Request $request): bool
    {
        if (app()->environment('production')) {
            return false;
        }

        $query = $request->query();
        $referer = parse_url((string) $request->headers->get('referer'), PHP_URL_QUERY);

        if (is_string($referer)) {
            parse_str($referer, $fromPage);
            $query = [...$query, ...$fromPage];
        }

        return array_intersect(PublicPageContext::QA_KEYS, array_keys($query)) !== [];
    }
}
